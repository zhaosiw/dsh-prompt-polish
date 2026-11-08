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

const LEVELS = ['smooth', 'structure', 'instruction']

const requestSchema = schemaOf((value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('PolishRequest 必须是对象')
  }
  if (typeof value.text !== 'string') throw new TypeError('PolishRequest.text 必须是字符串')
  if (!LEVELS.includes(value.level)) throw new TypeError('PolishRequest.level 必须是 smooth/structure/instruction')
  if (value.locale !== undefined && typeof value.locale !== 'string') throw new TypeError('PolishRequest.locale 必须是字符串')
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
      description: '按档位（smooth/structure/instruction）优化一段输入框草稿，返回可替换的成品文本。',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          description: '原文、档位与界面语种。',
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
        description: '输入框文字优化服务（ctx.promptPolish），把草稿交给模型做三档改写，不写 Session。',
        summary: '输入框文字优化服务 (composer prompt polish)。',
        tags: ['prompt', 'composer', 'polish'],
        jsDoc: '/** dsh-prompt-polish 的 promptPolish 服务。 */',
        members: [
          {
            kind: 'method',
            name: 'polish',
            signature: 'polish(request: PolishRequest): Promise<PolishResult>',
            summary: '按档位优化一段草稿文本。Polish a draft at the requested level.',
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
