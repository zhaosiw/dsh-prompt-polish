// 宿主半区的本地冒烟测试：用假 llm / 假 ctx 跑通 polish() 的正常与异常路径。
import { apply } from '../plugin/lib/index.js'

function fakeCtx({ reply, throwPrepare = false, noLlm = false, noModel = false } = {}) {
  const services = new Map()
  const llm = {
    listProviders: () => (noModel ? [] : [{ id: 'fake-provider' }]),
    listModels: () => (noModel ? [] : [{ id: 'fake-model' }]),
    async prepareCall(config) {
      if (throwPrepare && 'reasoningEffort' in config) throw new Error('reasoning unsupported')
      return {
        config: { ...config, reasoningEffort: 'off' },
        async *stream() {
          yield { type: 'block-start', blockType: 'text' }
          yield { type: 'text-delta', text: reply }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  }
  const ctx = {
    config: {},
    logger: { warn: () => {} },
    get(name) {
      if (name === 'llm') return noLlm ? undefined : llm
      if (name === 'agentDefaultModel') return noModel ? undefined : { currentSelection: () => ({ provider: 'fake-provider', model: 'fake-model' }) }
      return services.get(name)
    },
    provide(name, value) {
      services.set(name, value)
    },
  }
  apply(ctx)
  return services.get('promptPolish')
}

const cases = [
  {
    name: '正常：围栏 JSON 输出',
    service: fakeCtx({ reply: '```json\n{"text":"请把 A 改成 B。","notes":["显式化目标"],"assumptions":[]}\n```' }),
    request: { text: '把 a 弄成 b 吧', level: 'structure', locale: 'zh' },
  },
  {
    name: '降级：prepareCall 拒绝 reasoning=off 后重试',
    service: fakeCtx({ reply: '{"text":"保留原文","notes":[],"assumptions":["待确认参数 X"]}', throwPrepare: true }),
    request: { text: '随便写点', level: 'smooth' },
  },
  {
    name: '兜底：非 JSON 整段当正文',
    service: fakeCtx({ reply: '直接给一段普通文字' }),
    request: { text: '优化我', level: 'instruction' },
  },
  { name: '空输入', service: fakeCtx({ reply: 'x' }), request: { text: '   ', level: 'smooth' } },
  { name: '无模型服务', service: fakeCtx({ reply: 'x', noLlm: true }), request: { text: '有内容', level: 'smooth' } },
  { name: '无可用模型', service: fakeCtx({ reply: 'x', noModel: true }), request: { text: '有内容', level: 'smooth' } },
]

for (const item of cases) {
  const result = await item.service.polish(item.request)
  console.log('---', item.name)
  console.log(JSON.stringify(result, null, 2))
}
