/**
 * dsh-prompt-polish 的 Host 面 Typert 清单（由 typert-loader 自动扫描注册）。
 *
 * 与 @deepseek-ai/dsh-typert-generator 产物同构：`./typert` 导出 TYPERT，
 * 每个 codec 必须提供 `create()` 工厂，返回可 `.parse()` 的 schema
 * （网关侧实现是 `codec.create().parse(value)`，见 dsh-api-gateway 的 decode()）。
 * 这里用最小手写 schema，避免为了一行校验拉一个 zod 依赖。
 */

/** 手写 strict schema：只要 parse()，校验失败抛错即被网关转成 input-invalid。 */
function schemaOf(validate, label) {
  return {
    label,
    parse(value) {
      validate(value)
      return value
    },
  }
}

const requestSchema = schemaOf((value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('PolishRequest 必须是对象')
  }
}, 'PolishRequest')

const resultSchema = schemaOf((value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('PolishResult 必须是对象')
  }
  if (typeof value.ok !== 'boolean') throw new TypeError('PolishResult.ok 必须是布尔值')
}, 'PolishResult')

/** 严格 codec：mode + typeSymbol + create() 工厂。 */
function strictCodec(typeSymbol, schema) {
  return {
    mode: 'strict',
    typeSymbol,
    create: () => schema,
  }
}

const requestCodec = strictCodec('dsh-prompt-polish#PolishRequest', requestSchema)
const resultCodec = strictCodec('dsh-prompt-polish#PolishResult', resultSchema)

export const TYPERT = {
  package: 'dsh-prompt-polish',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'dsh-prompt-polish#promptPolish/polish',
      service: 'promptPolish',
      namespace: 'promptPolish',
      method: 'polish',
      description: '优化一段输入框草稿：深度由模型自判，返回可直接替换的回填文本。',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          description: '原文与界面语种。',
          source: 'json',
          codec: requestCodec,
        },
      ],
      result: resultCodec,
    },
  ],
  model: {
    services: [
      {
        key: 'promptPolish',
        exportName: 'PromptPolishService',
        description: '输入框文字优化服务（ctx.promptPolish），把草稿交给模型改写，不写 Session。',
        summary: '输入框文字优化服务 (composer prompt polish)。',
        tags: ['prompt', 'composer', 'polish'],
        jsDoc: '/** dsh-prompt-polish 的 promptPolish 服务。 */',
        members: [
          {
            kind: 'method',
            name: 'polish',
            signature: 'polish(request: PolishRequest): Promise<PolishResult>',
            summary: '一键优化一段草稿文本。Polish a composer draft in one click.',
          },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
}

export default TYPERT
