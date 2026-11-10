/**
 * dsh-prompt-polish — 宿主半区。
 *
 * 只做一件事：把 composer 里的一段草稿交给模型做「三档优化」，返回可替换的成品文本。
 * 不写 Session、不产生对话轮次、不改账本；调用者（浏览器半区）拿到结果后自行预览与回填。
 *
 * 注册面：`ctx.provide('promptPolish', service)` + 同目录 `./typert` 清单，
 * 浏览器侧经 `remote.promptPolish.polish({...})` 调用。
 */

export const name = 'prompt-polish'

/** 版本号跟着 package.json 走；回填结果里带一份，方便排查线上跑的是哪一版。 */
const PLUGIN_VERSION = '0.2.0'

/** 三档：轻度顺滑 / 中度结构化 / 重度指令化。 */
const LEVELS = new Set(['smooth', 'structure', 'instruction'])

const LEVEL_ZH = {
  smooth: '轻度（只做语法与表达顺滑）',
  structure: '中度（补齐结构与关键约束）',
  instruction: '重度（重组为更明确的指令）',
}

const SYSTEM_PROMPT = `你是 DSH 输入框的「指令润色器」：把用户准备发给 AI Agent 的草稿改得更好用，但绝不改变本意。

绝对规则（各档通用）：
1. 不新增事实、参数、需求；不删信息点；不改意图、优先级、语气强度。
2. 逐字保留：@引用、/命令、代码与行内代码、URL、路径、环境变量、标识符、命令与参数、数字与单位、版本号、IP/端口/域名、引号内原文。
3. 用原文语言输出，不翻译、不加前言或总结。
4. 只输出 JSON：{"text": "...", "notes": ["..."], "assumptions": ["..."]}。text 可直接替换原文；notes ≤3 条、每条 ≤20 字；无假设给空数组。
5. 原文已足够好时，text 原样返回，notes 写「原文已清晰」。

档位（只做该档允许的事）：
- smooth：只修语法、错别字、标点、赘词、指代与衔接；句序与段落不动；长度变化 ≤±15%。
- structure：显式化隐含结构——该分点的分点、该编号的编号，补清对象/范围/输出格式/禁止项；可并拆句、调段落；每句都要能在原文找到出处。
- instruction：重组成可直接执行的指令，通常含目标、输入/上下文、约束（含禁止项）、输出格式、验收标准；把模糊表述收敛成可执行描述；原文没有的参数不写，或写进 assumptions 并标「待确认」。`

/** 单次调用预算：按档位收紧上限——越短越快，但结构性改写一定会变长，下限要留够。 */
const TOKEN_BUDGET = {
  smooth: { cap: 900, floor: 700 },
  structure: { cap: 2400, floor: 1200 },
  instruction: { cap: 3600, floor: 1600 },
}
function tokenBudget(text, level) {
  const shape = TOKEN_BUDGET[level] ?? TOKEN_BUDGET.structure
  const wanted = Math.ceil(text.length * 2.4) + 400
  return Math.min(shape.cap, Math.max(shape.floor, wanted))
}

/** 从可能带围栏/前后缀的模型输出里取出 JSON 对象；失败返回 null。 */
function extractJson(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  let text = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  if (fence !== null) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

/** 反转义 JSON 字符串里常见的几种转义；不用 JSON.parse 是为了容忍被截断的输出。 */
function unescapeLoose(value) {
  return String(value)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

/**
 * 从半成品 JSON 里抢救 `"text"` 的正文：即使输出被 maxTokens 截断、字符串没闭合，
 * 也照样把已经写出来的部分还原成纯文本，绝不把裸 JSON 交给调用方。
 */
function salvageText(raw) {
  const source = typeof raw === 'string' ? raw : ''
  const anchor = source.search(/"text"\s*:\s*"/)
  if (anchor === -1) return null
  const quote = source.indexOf('"', source.indexOf(':', anchor))
  if (quote === -1) return null
  const body = source.slice(quote + 1)
  let end = -1
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]
    if (char === '\\') {
      i += 1
      continue
    }
    if (char === '"') {
      end = i
      break
    }
  }
  const slice = end === -1 ? body : body.slice(0, end)
  const text = unescapeLoose(slice).trim()
  return text === '' ? null : text
}

/** 把模型输出规整成 {text, notes, assumptions}；非 JSON 时整段当正文。 */
function normalizeOutput(raw) {
  const parsed = extractJson(raw)
  if (parsed === null || typeof parsed.text !== 'string') {
    // 输出被截断 / 转义不合法时：从 `"text": "…"` 里抢救正文，别把裸 JSON 塞回输入框。
    const salvaged = salvageText(raw)
    if (salvaged !== null) return { text: salvaged, notes: [], assumptions: [] }
    const text = typeof raw === 'string' ? raw.trim() : ''
    // 明明是半个 JSON 却连正文都取不到：宁可报错，也不写进输入框。
    if (/^\s*\{/.test(text) && /"[\w-]+"\s*:/.test(text)) {
      throw Object.assign(new Error('模型输出被截断，请重试'), { code: 'EMPTY_RESPONSE' })
    }
    return { text, notes: [], assumptions: [] }
  }
  const strings = (value) =>
    Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim() !== '').slice(0, 6) : []
  return {
    text: parsed.text,
    notes: strings(parsed.notes).slice(0, 3),
    assumptions: strings(parsed.assumptions),
  }
}

/** 选择调用目标：当前默认模型 > 列目录里的第一个可用模型。 */
function resolveTarget(ctx) {
  const defaults = ctx.get('agentDefaultModel')
  const selection = defaults?.currentSelection?.()
  if (selection?.provider && selection?.model) {
    return { provider: String(selection.provider), model: String(selection.model) }
  }
  const llm = ctx.get('llm')
  if (llm === undefined) return null
  const providers = llm.listProviders?.() ?? []
  for (const row of providers) {
    const id = typeof row === 'string' ? row : row?.id
    if (typeof id !== 'string' || id === '') continue
    const models = llm.listModels?.(id) ?? []
    const first = models.find?.((model) => typeof (model?.id ?? model) === 'string')
    const modelId = typeof first === 'string' ? first : first?.id
    if (typeof modelId === 'string' && modelId !== '') return { provider: id, model: modelId }
  }
  return null
}

/** 逐块读取流，拼出正文并记录结束原因。 */
async function streamText(prepared, options) {
  let text = ''
  let terminal = null
  for await (const chunk of prepared.stream(options)) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    else if (chunk?.type === 'finish') terminal = chunk.reason ?? terminal
  }
  const reason = terminal?.kind ?? (typeof terminal === 'string' ? terminal : undefined)
  if (reason === 'error') throw Object.assign(new Error('模型返回错误'), { code: 'LLM_ERROR' })
  return { text, truncated: reason === 'length' || reason === 'max-tokens' }
}

/**
 * 创建 promptPolish 服务。手写 typertRemote 绑定（service/serviceKey/namespace），
 * 与 ./typert 清单一起走 Typert 网关，浏览器侧即 `remote.promptPolish.*`。
 */
function createService(ctx) {
  const service = {
    /**
     * 优化一段草稿。
     * @param request - { text, level, locale }
     * @returns { ok, text, notes, assumptions } 或 { ok: false, code, message }
     */
    async polish(request) {
      const text = typeof request?.text === 'string' ? request.text : ''
      const level = LEVELS.has(request?.level) ? request.level : 'structure'
      if (text.trim() === '') return { ok: false, code: 'EMPTY', message: '输入为空，没有可优化的文字' }

      const llm = ctx.get('llm')
      if (llm === undefined) return { ok: false, code: 'LLM_UNAVAILABLE', message: '模型服务未就绪，请稍后重试' }
      const target = resolveTarget(ctx)
      if (target === null) return { ok: false, code: 'NO_MODEL', message: '没有可用的模型，请先在设置里选择模型' }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('timeout')), 60000)
      try {
        const system = SYSTEM_PROMPT
        const messages = [{
          role: 'user',
          content: [{
            type: 'text',
            text: `level: ${level}\nlanguage: keep the original language\n原文：\n<<<\n${text}\n>>>`,
          }],
        }]
        const runOnce = async (budget) => {
          const base = { provider: target.provider, model: target.model, maxTokens: budget }
          let prepared
          try {
            // 润色属于低思考任务：优先关掉 reasoning；被拒就退回默认档。
            prepared = await llm.prepareCall({ ...base, reasoningEffort: 'off' }, controller.signal)
          } catch {
            prepared = await llm.prepareCall(base, controller.signal)
          }
          return streamText(prepared, { ...prepared.config, system, messages, signal: controller.signal })
        }
        const budget = tokenBudget(text, level)
        let result = await runOnce(budget)
        // 撞上 maxTokens：输出会被腰斩成半截 JSON，宁可重发一次更大的预算。
        if (result.truncated) result = await runOnce(Math.min(budget * 2, 6000))
        const raw = result.text
        if (raw.trim() === '') return { ok: false, code: 'EMPTY_RESPONSE', message: '模型没有返回内容，请重试' }
        const output = normalizeOutput(raw)
        if (output.text.trim() === '') return { ok: false, code: 'EMPTY_RESPONSE', message: '模型没有返回内容，请重试' }
        // 模型爱用连续空行分段，收一下；也去掉行尾空白，回填后不留痕。
        const tidy = output.text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
        return {
          ok: true,
          text: tidy,
          notes: output.notes,
          assumptions: output.assumptions,
          level,
          levelLabel: LEVEL_ZH[level],
          version: PLUGIN_VERSION,
          provider: target.provider,
          model: target.model,
        }
      } catch (error) {
        const aborted = controller.signal.aborted
        const code = aborted ? 'TIMEOUT' : (error?.code ?? 'REQUEST_FAILED')
        const message = aborted
          ? '优化超时（60 秒），可以点重试'
          : `优化失败：${error instanceof Error ? error.message : String(error)}`
        ctx.logger?.warn?.(`[dsh-prompt-polish] ${code}: ${message}`)
        return { ok: false, code, message }
      } finally {
        clearTimeout(timer)
      }
    },
  }
  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: 'promptPolish', namespace: 'promptPolish' },
  })
  return service
}

/** 挂载：注册 promptPolish 服务，供浏览器半区经 Remote 调用。 */
export function apply(ctx) {
  ctx.provide('promptPolish', createService(ctx))
}
