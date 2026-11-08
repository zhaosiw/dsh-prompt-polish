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

/** 三档：轻度顺滑 / 中度结构化 / 重度指令化。 */
const LEVELS = new Set(['smooth', 'structure', 'instruction'])

const LEVEL_ZH = {
  smooth: '轻度（只做语法与表达顺滑）',
  structure: '中度（补齐结构与关键约束）',
  instruction: '重度（重组为更明确的指令）',
}

const SYSTEM_PROMPT = `你是 DSH 输入框的「指令润色器」。用户会给你一段他准备发给 AI Agent 的原文，以及要求的优化档位。你的任务是让这段话更好用，但绝不能改变他的本意。

绝对规则（任何档位都适用）：
1. 不新增事实、参数、需求、要求；不删掉任何信息点；不改变意图、优先级、语气强度。
2. 原文中出现的这些必须逐字保留：@引用、/命令、代码块与行内代码、URL、路径、环境变量、标识符、命令与参数、数字与单位、版本号、IP/端口/域名、引号内原文。
3. 保持原文语言（中文写中文，英文写英文，中英混排照旧），不要翻译，不要加解释性前言或总结。
4. 只输出 JSON：{"text": "...", "notes": ["..."], "assumptions": ["..."]}。text 必须是可直接替换原文的成品；notes 最多 3 条、每条不超过 20 字；没有假设就给空数组。
5. 如果原文已经足够好，就在 text 里原样返回，notes 写「原文已清晰」。

档位（按用户给的 level 执行，只做该档允许的事）：
- smooth：只做语法、错别字、标点、赘词、指代与衔接的顺滑处理；句子顺序和段落结构不动；长度变化不超过 ±15%。
- structure：在 smooth 的基础上把隐含结构显式化——该分点的分点、该编号的编号、该补的约束（对象/范围/输出格式/禁止项）用原意补明确；可以合并拆句、调整段落顺序；长度可增加，但每一句都要能在原文找到出处。
- instruction：重组成一条明确、可直接执行的指令，通常包含目标、输入/上下文、约束（含禁止项）、输出格式、验收标准；把模糊表述收敛成可执行描述；原文没给的参数要么不写，要么放进 assumptions 并标注「待确认」。`

/** 单次调用预算：重度档会把内容展开，按原文长度给足空间，同时设上限防止失控。 */
function tokenBudget(text) {
  const chars = text.length
  return Math.min(8192, Math.max(1600, Math.ceil(chars * 3) + 800))
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

/** 把模型输出规整成 {text, notes, assumptions}；非 JSON 时整段当正文。 */
function normalizeOutput(raw) {
  const parsed = extractJson(raw)
  if (parsed === null || typeof parsed.text !== 'string') {
    // 输出被截断时 JSON 不完整：尽量从 `"text": "..."` 里抢救正文，别把裸 JSON 塞回输入框。
    const salvaged = /^\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(typeof raw === 'string' ? raw : '')
    if (salvaged !== null) {
      try {
        return { text: JSON.parse(`"${salvaged[1]}"`), notes: [], assumptions: [] }
      } catch {
        /* 转义不合法就走下面的原文兜底 */
      }
    }
    const text = typeof raw === 'string' ? raw.trim() : ''
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
  return text
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
        const base = {
          provider: target.provider,
          model: target.model,
          maxTokens: tokenBudget(text),
        }
        let prepared
        try {
          // 润色属于低思考任务：优先关掉 reasoning；被拒就退回默认档。
          prepared = await llm.prepareCall({ ...base, reasoningEffort: 'off' }, controller.signal)
        } catch {
          prepared = await llm.prepareCall(base, controller.signal)
        }
        const system = SYSTEM_PROMPT
        const messages = [{
          role: 'user',
          content: [{
            type: 'text',
            text: `level: ${level}\nlanguage: keep the original language\n原文：\n<<<\n${text}\n>>>`,
          }],
        }]
        const raw = await streamText(prepared, {
          ...prepared.config,
          system,
          messages,
          signal: controller.signal,
        })
        if (raw.trim() === '') return { ok: false, code: 'EMPTY_RESPONSE', message: '模型没有返回内容，请重试' }
        const output = normalizeOutput(raw)
        if (output.text.trim() === '') return { ok: false, code: 'EMPTY_RESPONSE', message: '模型没有返回内容，请重试' }
        return {
          ok: true,
          text: output.text,
          notes: output.notes,
          assumptions: output.assumptions,
          level,
          levelLabel: LEVEL_ZH[level],
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
