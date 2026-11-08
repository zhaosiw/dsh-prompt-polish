# 客户端 → Host LLM：Remote 通道调研（task-2）

> 只读调研。证据路径前缀缩写：
> `APP` = `D:\app\DeepSeek Harness\resources\app\dsh\node_modules\@deepseek-ai`
> `PROF` = `~\.dsh\profiles\web\node_modules`
> 结论已与 Lead 已写好的宿主半区对齐；`a/b/c` 三问在第 0 节答复。

---

## 0. 先答 Lead 的三问（核对结论）

**核对**：Lead 的四条已确认项全部与源码一致，仅两处需精修：

| Lead 的说法 | 核对结果 |
|---|---|
| `ctx.provide('ns', service)` + 不可枚举 `typertRemote` | ✅ 成立。样例见 `PROF\dsh-cost-meter\lib\index.js:575-633`；网关侧校验点 `APP\dsh-api-gateway\lib\index.js:1698-1710`（`validateBinding`/`readBinding` 要求 `binding.service === original`、`serviceKey === descriptor.service`、同名 namespace）。 |
| `TYPERT = { package, face:'host', schemas:[], invocations:[...], model:{...} }` | ✅ 成立。必需字段与校验见 `APP\dsh-typert-loader\lib\index.js:78-217`（`face` 必须 `'host'`、`schemas` 必须是数组）；直接调 `ctx.typert.register()` 时的校验在 `APP\dsh-typert-registry\lib\types\service.js:441-465`。 |
| codec 必须 `{mode:'strict', typeSymbol, create:()=>schema}` | ✅ **必须**。`APP\dsh-typert-loader\lib\index.js:229-235`（`requireStrictCodec` → `requireSchemaProjection` 要求 `typeof value.create === 'function'`）、`APP\dsh-typert-registry\lib\types\service.js:646-653`。`cost-meter` 只写 `schema:`（`PROF\dsh-cost-meter\lib\typert.host.js` 的 `_state$codec` 等），在该宿主上过不了校验，**不能照抄**。 |
| `prepareCall(...)` → `prepared.stream({...prepared.config, system, messages, signal})` | ✅ 成立，且 `{...prepared.config}` **是硬要求**（见 a）。样例 `APP\dsh-experimental-translator\lib\index.js:706-770`、`APP\dsh-session-title-llm\lib\index.js:196-227`。 |
| 模型来源 `ctx.get('agentDefaultModel').currentSelection()` | ✅ 成立，`APP\dsh-agent-default-model\lib\index.js:38-45`；服务在基准树中恒在（`APP\dsh-base\cordis.patch.yml:90-94`，默认 `deepseek-official / deepseek-flash`）。 |

### a) `prepared.stream` 的 options 必须传完整 `prepared.config` 吗？

**必须。** `prepared.stream(options)` 先做 `callConfigEquals(options, resolvedConfig)`，不等价直接抛 `INVALID_PREPARED_CALL`：

- `APP\dsh-llm\lib\index.js:2251` — `if (!callConfigEquals(options, resolvedConfig)) throw new LlmError(..., 'INVALID_PREPARED_CALL')`
- `APP\dsh-llm\lib\index.js:2327` — 适配器前再查一次
- `APP\dsh-llm\lib\index.js:367-371` — 比较字段：`provider, model, reasoningEffort, temperature, maxTokens`（+ `stop` 逐项）

所以只要 `prepareCall` 里出现 `reasoningEffort`（哪怕是 `undefined`→默认值被物化），options 里就少不得这一项。**唯一安全写法：`{...prepared.config, system, messages, signal}`**（title-llm 与 translator 都这么写）。

### a') `reasoningEffort:'off'` 被拒时的推荐兜底

**不要 try/catch 重试**（会多打一次 `prepareCall`，且 `reasoning.efforts` 里没有 `off` 时第二次仍要判断）。用第三个参数 `configure(controls, model)` 在物化默认值之前**查表选择**：

```js
const prepared = await ctx.llm.prepareCall(
  { provider, model, maxTokens },        // 不写 reasoningEffort
  signal,
  (controls, model) => {
    const off = model.reasoning?.efforts?.find((e) => e.id === 'off')
    return off === undefined ? controls : { ...controls, reasoningEffort: off.id }
  },
)
```

- `configure` 契约与 `model` 形状：`APP\dsh-llm\lib\index.js:2220-2231`（回调收到 `deepFreeze(modelInfo)`）、`:2182-2201`（`reasoning.efforts[].id` 校验，不支持即 `UNSUPPORTED_REASONING_EFFORT`）。
- `off | low | high | max` 是 deepseek 适配器公布的强度，`off` 会发 `thinking.type: disabled`：`APP\dsh-llm-deepseek\README.zh.md:103`。
- 想强制"必须关思考"时学 translator：物化后断言 `prepared.config.reasoningEffort !== 'off'` 即失败（`APP\dsh-experimental-translator\lib\index.js:714`）。

### b) 返回值必须完全匹配 result codec 吗？

**不必须，strict 也不会拒。** Host 回包只做编码透传：

- `APP\dsh-api-gateway\lib\index.js:1346` `encodeRpcResult(value, codec)`：strict 分支仅 `codec.encode?.(value) ?? value` —— 没有 `create().parse()`，多余/可选字段原样穿过；客户端也不解析返回值（`APP\dsh-api-gateway\lib\client.browser.js:1826-1832` 直接把 `result.value` 交给调用方）。
- 但 `result.codec.create` **必须是函数**（loader/registry 校验，见上表），它是给元数据/JSON Schema/类型面用的，不是运行时闸门。
- 例外：入参方向是**真校验**。`validateArguments`/`decode` 对 `source:'json'` 参数跑 `codec.create().parse(value)`（`APP\dsh-api-gateway\lib\index.js:1765-1790`），普通 `z.object` 会**剥掉未声明字段**、缺必填才报 `gateway/input-invalid`。另有 `assertExactArguments` 先拒"多字段/缺字段"（`:1750-1756`）——所以**客户端 args 的 key 集合必须与 descriptor 的 wire 集合逐一对上**。

### c) 这条路径确实不写 Session 的证据

1. **`ctx.llm` 本身完全不碰 Session**：`APP\dsh-llm\lib\index.js` 全文只有 2 处 "session"，且都在注释里（`:777`、`:1154`）；`GenerateOptions.sessionId` 甚至没被读（全文件 0 处 `sessionId`），是不透明透传字段。
2. **写日志是调用方的显式动作**：
   - 标题执行器把"确切请求"记成 `session/title-llm-request`（`APP\dsh-session-title-llm\README.zh.md:38,75`），靠显式记录才合规；同时明确"请求不带 agent loop 身份，也不进入对话历史"。
   - translator 只有在**调用方给了 `sessionId`** 时才落盘：`APP\dsh-experimental-translator\lib\index.js:403-404`（"Uncached translation requires an active Session"）→ `:409-435`（`appendPluginRecord(session, 'plugin:translator/request' | 'plugin:translator/result', …)`）。
3. **结论**：`polish` 方法**不接 sessionId、不调 `appendPluginRecord`**，则零 Session 写入、零对话轮次。旁路副作用仅两类：`llm/stream` waterfall 的监听者（如 `PROF\dsh-cost-meter\lib\index.js:560-585` 抓 `usage` 记账；`token` 计量），它们不写 Session 正文。
4. 已知取舍：`APP\dsh-llm\README.zh.md:12,61` 有"调用方必须确保模型可见输入可从会话日志重建"的**约定性**要求。标题/翻译两条内置路径都靠自建日志条目满足它；润色若完全不留痕，则偏离该约定（**无任何代码强制**）。若日后要合规，可仿 translator 追加一条自定义插件记录（需 `sessionId`），但那时就**不再是**"零 Session 写入"。建议当前版本留作已知取舍并写进插件 README。

---

## 1. 双半区包结构（范本：cot-translation）

### 1.1 包面

`APP\dsh-experimental-client-ui-cot-translation\package.json`

```jsonc
"type": "module",
"main": "lib/index.js",
"exports": {
  ".":       { "default": "./lib/index.js" },              // Host 插件入口（默认导出 TypertRemoteService 子类）
  "./client":{ "default": "./lib/client.js" },              // 浏览器 bundle（__ModuleLoader__ 工厂）
  "./remote":{ "types": "./lib/typert.remote-client.d.ts", "default": "./lib/typert.remote-client.js" },
  "./typert":{ "types": "./lib/typert.host.d.ts",        "default": "./lib/typert.host.js" }
},
"dsh": {
  "client": {
    "platform": "web",
    "inject": ["@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-client-locale",
               "@deepseek-ai/dsh-client-ui-chat", "@deepseek-ai/dsh-client-ui-plugin-manager",
               "@deepseek-ai/dsh-client-ui-settings"]
  }
}
```
（`:16-51`；`./typert` 供 typert-loader 自动注册，`./remote` 供浏览器挂载。）

### 1.2 typert 方法声明格式（生成物 = 纯 JS，可手写）

`APP\...\lib\typert.host.js:34-88`：

```js
const $remote = createTypertRemoteInfo({
  package: '@deepseek-ai/…-cot-translation',
  methods: {
    'cotTranslation/translate': {                     // 键 = "<namespace>/<method>"
      service: 'cotTranslation',                      // = Cordis 服务键 = descriptor.service
      description: '…',
      invocation: { kind: 'direct' },                 // 或 { kind:'context', context, wire }
      parameters: [{
        name: 'request', wire: 'request', source: 'json',
        description: '…',
        codec:       { mode:'strict', typeSymbol:'…#TranslationRequest', create: () => z.object({…}), jsonSchema: {…} },
        strictCodec: { mode:'strict', typeSymbol:'…#TranslationRequest', create: () => z.strictObject({…}), jsonSchema: {…} },
      }],
      cancellation: { parameter: 'signal' },           // 末位注入的 AbortSignal，不上线路
      result: { mode:'strict', typeSymbol:'…:result', create: () => z.string(), jsonSchema:{…} },
      sourceLocation: { file:'…src/index.ts', line:64, column:9 },
    },
  },
}, z)

export const TYPERT = {
  package: '…', face: 'host', schemas: [],
  get invocations() { return $remote.descriptors },    // 直接写数组也可
  model: { services:[{ key:'cotTranslation', exportName:'default', tags:[], members:[…], types:[…] }], events:[], objects:[] },
}
```

要点：
- **codec 一律 `create: () => zodSchema`**（不要写 `schema:`）。`strictCodec` 可选，仅 `input({strict:true})` 元数据用，不分发。
- 参数 `source` 只能 `'json'` 或 `'lookup'`；`signal` 不进 `parameters`，只写 `cancellation`。
- **Host 方法实参顺序 = `parameters[]` 顺序，signal 在最后**（`APP\dsh-api-gateway\lib\index.js:1195,1210,921`）。

### 1.3 Host 侧注册

```js
import z from '@deepseek-ai/schemastery'
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export default class CotTranslationController extends TypertRemoteService {
  static Config = z.object({
    provider: z.union(['bing','google','deepseek-account','deepseek-official']).default('bing').volatile(),
    targetLanguage: z.string().pattern(LANGUAGE_PREFERENCE_PATTERN).default('auto').volatile(),
  })
  constructor(ctx, config) {
    super(ctx, 'cotTranslation', { namespace: 'cotTranslation' })   // ← 服务键 + wire 命名空间
    this.config = config
    ctx.inject(['settings'], (child) => {
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    })
  }
  async translate(request, signal) { /* … */ }
}
```
（`APP\...\lib\index.js:155-169`；tanslate 失败包装 `:232-234` `throw new RemoteError('cotTranslation/failed','Translation failed',{})`。）

注册链：`./typert` 导出 → `typert-loader` 扫描 Loader 条目并 `ctx.typert.register()`（`APP\dsh-typert-loader\lib\index.js:296-367`，`ctx.typert.local` 得严格描述符）→ Gateway 分发时 `ctx.typert.local.get(endpoint)`（`APP\dsh-api-gateway\lib\index.js:1225-1228`）。
另有**无描述符回退（SRC 模式）**：`resolveSrcDescriptor` 会遍历 `ctx.reflect.props` 里 `typertRemote` 绑定 + `remoteMethods()` 标记来现推描述符（`:1230-1301`），参数按方法签名解析、全部按 JSON 处理。手写插件若清单校验失败会掉进这条路；但 SRC **要求原型上有 Remote 标记**，纯 `ctx.provide` 的对象没有，于是报 `gateway/invocation-unavailable`（这正是 `cost-meter` 在本宿主的风险点）。

### 1.4 浏览器侧调用

```js
// client.js（__ModuleLoader__ 工厂内）
const inject = ['remote', 'slots', 'locale', 'configForms']          // Cordis 服务名
async function apply(ctx) {
  const discard = new AbortController()
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE)              // 先挂载贡献
  const ui = ctx.inject(['remote.cotTranslation', 'slots', 'locale'], (child) => registerUi(child, discard))
  return async () => { await ui.dispose(); await unmount() }
}
// 调用点
const result = await ctx.remote.cotTranslation.translate({ ...request, sessionId }, signal)
if (!result.ok) throw result.error      // 一元调用永不 reject，只回 { ok:false, error }
return result.value
```
（`APP\...\lib\client.js:891-896` inject、`:1027-1040` $mount/卸载、`:983-988` 调用与错误冒泡、`:923` 带 signal 的只读调用。）

要点：
- 名字是 **`ctx.remote.<namespace>.<method>`**（不是 `ctx.remotes`），挂载后也可 `ctx.reflect.get('remote.<namespace>')`。
- **要 `await`**：返回 `RemoteResult` = `{ok:true,value} | {ok:false,error:RemoteError}`；`catch` 只出现在"本地/传输级"异常（`withdrawn`、无 connection）。
- 错误码：Host 抛的 `RemoteError(code,…)` 原样过线（`APP\dsh-api-gateway\lib\index.js:1673-1691`）；未分类异常折叠成 `gateway/internal`；取消折叠成 `gateway/cancelled`（`client.browser.js:2130-2135`）。
- 客户端贡献对象最小形状：`{ package:'<包名>', descriptors:[…] }`（`PROF\dsh-at-file\lib\client.js:14647-14650`），`$mount` 只强制"每个 codec 的 `mode === 'strict'`"（`client.browser.js:2101-2109`），**不要求 `create`**。

---

## 2. Host 侧发起一次 completion（system + user → 纯文本）

真实调用点：`APP\dsh-experimental-translator\lib\index.js:706-770`（最完整）、`APP\dsh-session-title-llm\lib\index.js:196-227`（含 deadline 包装）。

```js
import { BlockAssembler, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'

/** 一次"system+user → 纯文本"补全。 */
async function complete(ctx, { system, user, maxTokens, timeoutMs = 30_000, provider, model }, signal) {
  const llm = ctx.get('llm')
  const route = provider && model ? { provider, model } : ctx.get('agentDefaultModel')?.currentSelection()
  if (route === undefined) throw Object.assign(new Error('no model route'), { code: 'promptPolish/no-model' })

  const scope = deadline(signal, timeoutMs, 'PROMPT_POLISH_TIMEOUT')   // { signal, [Symbol.dispose]() }
  try {
    const prepared = await llm.prepareCall(
      { provider: route.provider, model: route.model, maxTokens },
      scope.signal,
      (controls, info) => {                                  // reasoning 优先关；不支持就不写
        const off = info.reasoning?.efforts?.find((e) => e.id === 'off')
        return off === undefined ? controls : { ...controls, reasoningEffort: ReasoningEffortId(off.id) }
      },
    )
    const assembler = new BlockAssembler()
    const stream = prepared.stream({
      ...prepared.config,                                    // ← 必带（callConfigEquals 逐字段比对）
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
      signal: scope.signal,
    })
    let terminal
    for await (const chunk of stream) {
      scope.signal.throwIfAborted()
      if (chunk.type === 'finish') terminal = chunk.reason
      assembler.push(chunk)
    }
    scope.signal.throwIfAborted()
    if (terminal?.kind === 'error') throw new Error(`llm error: ${terminal.error?.message ?? 'unknown'}`)
    if (terminal?.kind === 'aborted') throw scope.signal.reason ?? new Error('aborted')
    const text = assembler.blocks().filter((b) => b.type === 'text').map((b) => b.text).join('')
    if (text.trim() === '') throw new Error('empty completion')
    return { text, model: `${route.provider}/${route.model}` }
  } finally {
    scope[Symbol.dispose]()
  }
}
```

依据：
- `prepareCall(config, signal, configure)` 语义：`APP\dsh-llm\lib\index.js:2220-2261`；控制项就 `reasoningEffort / temperature / maxTokens`（`callConfigEquals`，`:367-371`）。
- `system` 是**单独字段**而非 system 消息（translator `:715,723-728` 把 `system` 与 `messages` 并列塞进 options）。
- `messages` 允许"仅请求"的普通对象 `{role,content}`（README:61；translator `:716-722` 就是裸对象，未用 `createUserMessage`）。要带归属时才用 `createUserMessage({content, source})`（`PROF\dsh-at-file\lib\index.js:15897`）。
- `finish` 块与 `assembler.finish`：`:1087-1100`（`{kind:'stop'|'error'|'aborted'|'tool-calls'|'max-tokens'}`；无 finish 时视为 `stop`）。
- `deadline(upstream, timeoutMs, code)`：`APP\dsh-timeout\lib\index.js:57-…`；`MAX_TIMER_DELAY_MS` 上限校验 `:27-29`；`timeoutOf(signal, code)` 辨类型 `:143-147`。
- abort 传播：Host 侧取消来自 descriptor 的 `cancellation`（`APP\dsh-api-gateway\lib\index.js:1196,1210`），方法必须自己 `throwIfAborted()`/透传，否则模型请求会跑完。

**reasoning off / effort**：支持。强度集 `off|low|high|max`（`APP\dsh-llm-deepseek\README.zh.md:45,58-59,103`）；`thinking: disabled` 部署策略会把所有请求锁死为 `off`，此时传其它强度会在加载期被拒（同 README:103）。跨适配器没有统一词表，故必须查 `model.reasoning.efforts`。

---

## 3. 模型与配置

**默认模型**：`ctx.get('agentDefaultModel').currentSelection()` → `{provider, model, reasoningEffort?}`（`APP\dsh-agent-default-model\lib\index.js:38-45`）。它在基准树里恒在（`APP\dsh-base\cordis.patch.yml:90-94`）。兜底：`ctx.get('llm').listProviders()` / `listModels(provider)`（`APP\dsh-llm\README.zh.md:28,59`）。注意它**不校验目录成员资格**（README:57）——用 `prepareCall` 才能拿到 `NO_ADAPTER` / `UNSUPPORTED_REASONING_EFFORT` 这类真错误。

**插件可配置项 = 插件自己的 Config（schemastery，不是 zod）**：

```js
import z from '@deepseek-ai/schemastery'
export const Config = z.object({
  level: z.union(['light','medium','heavy']).default('medium').volatile(),  // 进"设置"表单
  model: z.string().default(''),              // '' = 跟随默认模型
  maxTokens: z.natural().min(64).max(8192).default(2048).volatile(),
  timeoutMs: z.natural().min(1000).max(120000).default(30000).volatile(),
  maxInputChars: z.natural().min(1).default(4000),
})
```
- `volatile()` 字段才会出现在"设置"表单（`APP\dsh-settings\README.zh.md:33,39`），运行时用 `this.config.level.get()` 读引用（cot-translation `:160-161,182-183`；agent-default-model `:38-45`）。
- 自带页面时在 `ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto:false }, ctx.fiber)))` 关闭自动表单（`APP\dsh-settings\README.zh.md:39`；cot-translation `:166-168`）。
- 独立命名空间写法（不挂在插件 Config 上）：`ctx.settings.register(settingsNamespace('at-file'), Schema.object({…}), { applies:'live' })`（`PROF\dsh-at-file\lib\index.js:15828-15840`）。
- **zod v4 只用于 wire codec**（`invocations[].codec.create`）与客户端贡献；Host 配置一律 schemastery。两套并存是官方现状（cot-translation `package.json:57-61`：`schemastery` + `zod` 同时是 dependencies）。
- `docs/config-catalog.zh.md` 在本安装中**不可访问**（`D:\app\DeepSeek Harness\resources\app` 下无 `docs/`，asar 内也未解出）；配置字段真源只能靠各包 README 表格。

---

## 4. 打包要求

**结论：`lib/*.js` 必须是已构建好的成品 ESM/工厂包；宿主运行时不会用 esbuild 打包 `src/`。**

| 主张 | 证据 |
|---|---|
| 宿主只提供已构建的客户端 bundle，缺失即激活失败 | `APP\dsh-client-modules\README.zh.md:53-55`："宿主提供的是已构建的客户端 bundle，因此启动前 `pnpm run build` 必须已产出每个 `lib/client.js`；缺失 bundle 会明确导致激活失败"；"源码启动…仍消费这一构建后的客户端导出"。 |
| bundle 只做组合/切片/加 sourcemap，不做转译 | 同 README `:79`（快照 `client.js` 入口、按 mtime/ctime/size 算 revision、combo 脚本 = 直接拼接）；`:38`（浏览器只注册 factory，惰性物化）。 |
| externals 只能是平台模块表或其它插件的 bundle row | `:51` + 平台表实值（外壳 `WEBFRONTEND\dist\assets\index-*.js` 的 `staticModules`）：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。**其余一律要么打进 bundle，要么经 `dsh.client.inject` 指到别的插件 row。** |
| 插件管理器的安装流程里没有"构建你的源码"这一步 | `APP\dsh-plugin-manager\README.zh.md:50`："包、bundle patch 或已构建入口缺失时报告诊断…使用 `pnpm install` 和 `pnpm run build` 准备 **checkout**；链接包…**代码改变后仍需重新构建并重启**"；`:100` 只做重组合/逐出模块。 |
| Host 半区同样吃成品 ESM | 各包 `"main": "lib/index.js"` + `files` 只列 `lib/*.js`；typert-loader 直接 `import()` 解析出的 `./typert` 产物（`APP\dsh-typert-loader\lib\index.js:296-340`）。 |

实操建议（本项目）：
1. Host 半区 `lib/index.js`：**手写即可**，`import` 官方包（它们是宿主已有依赖）；无构建步骤。
2. `lib/typert.host.js`：**手写** `TYPERT`（`dsh-typert-generator` 未随安装发布，`APP\` 下无该包）。
3. `lib/client.js`：两种都行 —— (a) esbuild 打成 `__ModuleLoader__.load({ id, factory })`（at-file 范本，`PROF\dsh-at-file\lib\client.js:1-2`）；(b) 直接手写该工厂外壳，`const { z } = require('zod')`、`require('react/jsx-runtime')` 全走平台表，**零构建**。注意 `id` 必须等于包名（`client-modules README:77`"包名作为浏览器模块身份"）。
4. `package.json` 必备：`"type":"module"`、`main`/`exports`（`.`、`./client`、`./typert`、`./package.json`）、`dsh.client.{platform:'web', inject:[…]}`、`files` 只列 `lib`。`peerDependencies` 参考 at-file 的写法：`@deepseek-ai/*` 全部 `optional:true`（`PROF\dsh-at-file\package.json` peerDependenciesMeta），`zod` 进 `dependencies`（或客户端内联打包）。

---

## 5. 副作用（不写 Session）

见 §0-c。补充两条工程注意事项：

1. **别把 `sessionId` 送进 `ctx.llm` 的 options**：不是"会写"，而是会误导下游（cost-meter 按 `options.sessionId` 归账，`PROF\dsh-cost-meter\lib\index.js:572-580`）。
2. **别复用 `@deepseek-ai/dsh-session-title-llm` 的执行器**：它必定写 `session/title-llm-request`（`README.zh.md:38,75`）。要零写入就自己 `prepareCall + stream`。
3. 若未来要"可审计"，加一条 `appendPluginRecord(session, 'plugin:prompt-polish/request', …)` 即可（translator 同款，`:409-435`）——那时需要 `sessionId` 且 session 必须活动。

---

## 6. 最小可行骨架（`polish`，可直接改造）

### 6.1 `lib/typert.host.js`（Host 清单，手写）

```js
import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'

export const POLISH_REQUEST = () => z.object({
  text: z.string().min(1).max(20000),
  level: z.union([z.literal('light'), z.literal('medium'), z.literal('heavy')]),
  language: z.string().optional(),
})

export const POLISH_RESULT = () => z.object({ text: z.string() })

const $remote = createTypertRemoteInfo({
  package: 'dsh-prompt-polish',
  methods: {
    'promptPolish/polish': {
      service: 'promptPolish',
      description: 'Rewrite one composer draft at a chosen strength; returns text only.',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request', wire: 'request', source: 'json', description: 'draft + level',
        codec: { mode: 'strict', typeSymbol: 'dsh-prompt-polish#PolishRequest', create: POLISH_REQUEST },
      }],
      cancellation: { parameter: 'signal' },
      result: { mode: 'strict', typeSymbol: 'dsh-prompt-polish#PolishResult', create: POLISH_RESULT },
    },
  },
}, z)

export const TYPERT = {
  package: 'dsh-prompt-polish',
  face: 'host',
  schemas: [],
  get invocations() { return $remote.descriptors },
  model: {
    services: [{
      key: 'promptPolish', exportName: 'default', tags: [], jsDoc: undefined,
      members: [
        { kind: 'method', name: 'polish', signature: 'async polish(request: PolishRequest, signal: AbortSignal): Promise<PolishResult>' },
      ],
      types: [],
    }],
    events: [], objects: [],
  },
}
export default TYPERT
```

### 6.2 `lib/index.js`（Host 服务）

```js
import z from '@deepseek-ai/schemastery'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

const SYSTEM = {
  light: 'You are a copy editor. Fix grammar and typos only; keep wording, tone and structure.',
  medium: 'You are an editor. Rewrite for clarity and flow; keep the meaning, language and rough length.',
  heavy: 'You are a senior editor. Restructure for maximum clarity and impact; keep the meaning and language.',
}
const GUIDE = 'Return only the rewritten text. No explanations, no quotes, no markdown fences.'

export default class PromptPolish extends TypertRemoteService {
  static Config = z.object({
    model: z.string().default('').volatile(),        // '' = 跟随 agentDefaultModel
    maxTokens: z.natural().min(64).max(8192).default(2048).volatile(),
    timeoutMs: z.natural().min(1000).max(120000).default(30000).volatile(),
    maxInputChars: z.natural().min(1).default(8000),
  })

  constructor(ctx, config) {
    super(ctx, 'promptPolish', { namespace: 'promptPolish' })
    this.config = config
    ctx.inject(['settings'], (child) => {
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    })
  }

  /** 改写草稿。 */
  async polish(request, signal) {
    signal.throwIfAborted()
    const text = request.text?.trim() ?? ''
    if (text === '') throw new RemoteError('promptPolish/empty-input', 'Nothing to polish', {})
    if (text.length > this.config.maxInputChars.get()) {
      throw new RemoteError('promptPolish/input-too-long', 'Draft exceeds maxInputChars', { limit: this.config.maxInputChars.get() })
    }
    const llm = this.ctx.get('llm')
    const selection = this.ctx.get('agentDefaultModel')?.currentSelection()
    const modelId = this.config.model.get()
    const route = modelId === ''
      ? selection
      : { provider: selection?.provider ?? 'deepseek-official', model: modelId }
    if (route === undefined) throw new RemoteError('promptPolish/no-model', 'No model route is configured', {})

    const scope = deadline(signal, this.config.timeoutMs.get(), 'PROMPT_POLISH_TIMEOUT')
    try {
      const prepared = await llm.prepareCall(
        { provider: route.provider, model: route.model, maxTokens: this.config.maxTokens.get() },
        scope.signal,
        (controls, info) => {
          const off = info.reasoning?.efforts?.find((e) => e.id === 'off')
          return off === undefined ? controls : { ...controls, reasoningEffort: off.id }
        },
      )
      const assembler = new BlockAssembler()
      let terminal
      for await (const chunk of prepared.stream({
        ...prepared.config,
        system: `${SYSTEM[request.level] ?? SYSTEM.medium} ${GUIDE}`,
        messages: [{ role: 'user', content: [{ type: 'text', text }] }],
        signal: scope.signal,
      })) {
        scope.signal.throwIfAborted()
        if (chunk.type === 'finish') terminal = chunk.reason
        assembler.push(chunk)
      }
      scope.signal.throwIfAborted()
      if (terminal?.kind === 'error') throw new RemoteError('promptPolish/llm-failed', 'Model request failed', {})
      const out = assembler.blocks().filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
      if (out === '') throw new RemoteError('promptPolish/empty-output', 'Model returned no text', {})
      return { text: out }
    } catch (error) {
      if (error instanceof RemoteError) throw error
      if (scope.signal.aborted) throw new RemoteError('promptPolish/timeout', 'Polish timed out', {})
      throw new RemoteError('promptPolish/failed', 'Polish failed', {})
    } finally {
      scope[Symbol.dispose]()
    }
  }
}
```

错误码（都在远端原样可见，前端按 `error.code` 分支）：
`promptPolish/empty-input` · `promptPolish/input-too-long` · `promptPolish/no-model` · `promptPolish/timeout` · `promptPolish/llm-failed` · `promptPolish/empty-output` · `promptPolish/failed`；
框架级：`gateway/cancelled`（用户取消）、`gateway/internal`（未分类）、`gateway/input-invalid`（args 不合 schema）、`gateway/service-unavailable`（服务没挂上）。

### 6.3 `lib/client.js`（浏览器半区，手写工厂，零构建）

```js
// 工厂外壳手写，无需 esbuild；id 必须等于包名。
window.__ModuleLoader__.load({
  id: 'dsh-prompt-polish',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const { z } = require('zod')            // zod 在平台模块表内

    const POLISH_REMOTE = {
      package: 'dsh-prompt-polish',
      descriptors: [{
        id: 'dsh-prompt-polish#promptPolish/polish',
        service: 'promptPolish', namespace: 'promptPolish', method: 'polish',
        invocation: { kind: 'direct' },
        parameters: [{
          name: 'request', wire: 'request', source: 'json',
          codec: { mode: 'strict', typeSymbol: 'dsh-prompt-polish#PolishRequest',
                   create: () => z.object({ text: z.string(), level: z.enum(['light','medium','heavy']), language: z.string().optional() }) },
        }],
        cancellation: { parameter: 'signal' },
        result: { mode: 'strict', typeSymbol: 'dsh-prompt-polish#PolishResult', create: () => z.object({ text: z.string() }) },
      }],
    }

    const inject = ['remote', 'slots', 'locale']       // 再加 task-1 需要的 composer 相关服务

    async function mount(ctx) {
      const lifetime = new AbortController()
      ctx.effect(() => () => { lifetime.abort() }, 'prompt-polish: cancellation')
      const unmountRemote = await ctx.remote.$mount(POLISH_REMOTE)      // 必须先挂载
      const ui = ctx.inject(['remote.promptPolish', ...inject.slice(1)], (child) => registerUi(child, lifetime))
      try { await ui } catch (error) { await ui.dispose(); await unmountRemote(); throw error }
      return async () => { await ui.dispose(); await unmountRemote() }  // apply 返回 disposer
    }

    /** 改写草稿：成功返回文本，失败抛 RemoteError。 */
    function makePolish(ctx, lifetime) {
      return async (text, level, signal) => {
        const api = ctx.get('remote.promptPolish')
        if (api === undefined) throw new Error('prompt-polish: remote not mounted')
        const result = await api.polish({ text, level }, AbortSignal.any([lifetime.signal, signal]))
        if (!result.ok) throw result.error          // 一元调用不 reject，只回 RemoteResult
        return result.value.text
      }
    }

    function registerUi(ctx, lifetime) {
      // 按 task-1 的结论注册 conversation.input.activity / overlay slot；
      // 组件内用 makePolish(ctx, lifetime) 触发三档改写并把返回值写回输入框。
    }

    async function apply(ctx) { return await mount(ctx) }
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
```

### 6.4 `package.json`（最小）

```jsonc
{
  "name": "dsh-prompt-polish",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".":        { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./typert": { "default": "./lib/typert.host.js" },
    "./package.json": "./package.json"
  },
  "dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-client-ui-conversation"] } },
  "files": ["lib"],
  "peerDependencies": { "@deepseek-ai/cordis": "*", "@deepseek-ai/dsh-llm": "*", "@deepseek-ai/dsh-typert-protocol": "*", "@deepseek-ai/dsh-agent-default-model": "*", "@deepseek-ai/schemastery": "*", "zod": "*" },
  "peerDependenciesMeta": { "@deepseek-ai/cordis": { "optional": true } },
  "dependencies": { "zod": "^4.4.3" }
}
```

---

## 7. 未定 / 备选方案

| 项 | 状态 | 备选 |
|---|---|---|
| 官方 `docs/config-catalog.zh.md`、`docs/api-gateway.zh.md` | 本安装不可访问（无 `docs/` 目录） | 以各包 `README.zh.md` + 实现为准（本文即如此） |
| `dsh-typert-generator` | 未随安装发布 | 手写 `TYPERT`（§6.1），或干脆走 SRC 回退（需原型 Remote 标记） |
| 客户端平台的 `@deepseek-ai/dsh-client-runtime` | 平台模块表中**不存在**该 id（仅 at-file 之类旧插件引用） | 只用平台表里的 id；`ctx.remote`/`slots` 等服务靠 `dsh.client.inject` + Cordis 服务注入取得 |
| 润色是否需要"可重建"记录 | 未定（约定 vs 零写入冲突） | 默认零写入；如需审计再加 `appendPluginRecord`（§5.3） |
| `level` 档位提示词 | 未定稿 | 骨架里给了 light/medium/heavy 三版 system，可直接改 |
