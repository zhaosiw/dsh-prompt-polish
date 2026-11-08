# DSH composer 扩展点：slot / 草稿读写 / 快捷键

> 只读调研结论。宿主：`D:\app\DeepSeek Harness\resources\app\dsh\node_modules\@deepseek-ai\*`（0.2.1-rc.2）。
> 全部结论都带 `file:line`。路径别名：
>
> - `CONV` = `dsh-client-ui-conversation\lib\client.js`
> - `VCON` = `dsh-experimental-client-ui-voice-input\lib\client.js`
> - `SHORT` = `dsh-client-shortcuts\lib\client.js`
> - `REND` = `dsh-client-ui-renderer\lib\client.js`
> - `MODS` = `dsh-client-modules\lib\client.js`
> - `SESS` = `dsh-client-ui-session\lib\client.js`
> - `MSEL` = `dsh-client-ui-model-selection\lib\client.js`
> - `FE` = `dsh-web-frontend\dist\assets\index-CN7NIWNw.js`（Web 前端已构建产物，模块表在这里）
> - `SKILL` = `dsh-agent-preset\skills\cordis-plugin-development\`
>
> 所有 `D:\app` 下文件均未修改；未重启宿主。

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 面板放哪 | **`conversation.input.dock`**（list/session，渲染在 composer 卡片**上方**，TodoDock/QueueDock 同位置） |
| 按钮放哪 | **`conversation.input.left`**（list/session，左侧工具行，紧邻 `+`） |
| **不要**用 | `conversation.input.activity` —— `kind: "single"`，语音输入插件已占用（`VCON:2919`），且展开时会把 `.tools` 整行藏掉 |
| 读全文 | 组件内 `useInput().draft`；宿主侧 `shell.snapshot.draft` |
| 读选区 | `inputActions.captureInsertion()` → `{start, end, draftRev}`（**detect 坐标**）；宿主侧 `shell.caretSpan()` / `shell.projection` |
| 整体替换 | `inputActions.setDraft(text)`（**无版本/阶段守卫**）；宿主侧 `shell.setDraft(text)` |
| 替换选区 | `inputActions.insertText(text, span)`（有 `draftRev` + phase 守卫，返回 boolean） |
| 焦点/光标 | 两条 API 都**不调用** `focus()`，只改 Lexical 选区；靠按钮 `onMouseDown: e => e.preventDefault()` 保住焦点；宿主侧可 `shell.focus()` |
| 快捷键 | `ctx.shortcuts.register({ id, label, defaults, regions, modals, resolve })`，**自动进设置 UI**，与固定键位冲突会被拒绝/禁用 |
| 组件 React | `require('react')` / `require('react/jsx-runtime')`（模块表内置）；**官方明确不要 require ui-primitives** |
| 样式 | 只用 `--dsw-alias-*` / `--dsw-radius-*` / `--dsh-composer-*` token；`<style>` 自注入（loader 会按 owner 认领并随失效清理） |
| 会话上下文 | `sessionId`（plain prop）、`useProjection("modelSelection")`（当前模型）、`ctx.locale` + `t` |
| 模型调用 | 见 task-2（`notes/host-llm.md`）；本文只给 `ctx.remote.*` 的接入位 |

---

## 1. composer 相关 slot 清单

### 1.1 权威来源：`conversation.composer.bar` 的 children 声明

`CONV:19880-19920` 一次性声明了 composer 卡片内**全部**子 slot（`kind` / `scope` 就是这里定的）：

```js
// CONV:19880-19920（节选，原文逐字）
const registerComposerBar = () => slots.register({
  name: "conversation.composer.bar",
  locale: NS,
  children: {
    "conversation.input.attachments": { kind: "single", scope: "session-maybe" }, // 19884
    "conversation.input.overlay":     { kind: "list",   scope: "session" },       // 19888
    "conversation.input.permission":  { kind: "single", scope: "session" },       // 19892
    "conversation.input.left":        { kind: "list",   scope: "session" },       // 19896
    "conversation.input.plan":        { kind: "single", scope: "session" },       // 19900
    "conversation.input.right":       { kind: "list",   scope: "session" },       // 19904
    "conversation.input.model":       { kind: "single", scope: "session" },       // 19908
    "conversation.input.activity":    { kind: "single", scope: "session" },       // 19912
    "conversation.composer.dock":     { kind: "list",   scope: "session" },       // 19916
  },
}, InputBar);
```

`conversation.input.dock` 与 `conversation.composer.dock` 都在 `conversation.composer.bar` 的同级声明里（`CONV:19746-19753` / `CONV:19916`），`conversation.composer` 是 `chain`（`CONV:19742`）。

### 1.2 逐 slot 事实表

| slot | kind | scope | 渲染位置（证据） | 宿主传入的 owner props | 状态 |
|---|---|---|---|---|---|
| `conversation.input.left` | list | session | `CONV:19072` `renderSlot("conversation.input.left", {})`，在 `div.tools` 内（`+` 按钮 / 权限 / plan 之后） | `{}` | **空，可用** |
| `conversation.input.right` | list | session | `CONV:19080`，在 `div.standardControls` 内、**模型选择器左侧** | `{}` | 空，可用 |
| `conversation.input.plan` | single | session | `CONV:19070` | `{ locked }` | 已占（plan 插件） |
| `conversation.input.permission` | single | session | `CONV:19070` | `{ locked }` | 已占 |
| `conversation.input.model` | single | session | `CONV:19080` | `{ locked: modelSeatLocked }` | 已占（模型选择） |
| `conversation.input.attachments` | single | session-maybe | `CONV:19006`（卡片内、编辑器上方） | `{ attachments, canAcceptDrop, onAddFiles, onRemoveAttachment, uploads, onRetryFile, dropLimits }` | 已占 |
| `conversation.input.overlay` | list | session | `CONV:18997-19001`，包在 `div.overlayAnchor[data-composer-overlay]` 里 | `{}` | 空，可用 |
| `conversation.input.activity` | **single** | session | `CONV:19082-19088`，模型选择器与发送按钮之间 | **`{ locked, onActiveChange }`** | 已被 voice-input 占（`VCON:2919-2923`） |
| `conversation.composer.dock` | list | session | `CONV:19161-19168`，卡片**内部底部** `div.dock[data-composer-dock]`，与 ContextMeter 并排 | `{}` | 可用 |
| `conversation.input.dock` | list | session | `CONV:17842`（`composerStack` 内、`inputBar` **之前** → 整个卡片上方） | `{ session, input }`（`CONV:17779-17782`） | 可用（Todo/Queue 用了） |
| `conversation.composer` | **chain** | session | `CONV:17846-17854`，`overlay: true` 的 composer takeover | `{ sessionId, session, pendingInteraction }` | 强介入，不建议 |
| `conversation.composer.bar` | single | session-maybe | 默认 composer 本体 | 见 §1.4 | 已占（本包自己） |

`conversation.input.activity` 的语义（README 权威描述，`README.zh.md:167`）：

> `conversation.input.activity` 在模型选择器与发送按钮之间承载一个控件。其 `onActiveChange` 回调将控件展开至整条工具栏并隐藏普通辅助控件和上下文用量按钮，同时保留编辑器与提交按钮。

—— 即 **single（只能一个占用者）+ 展开会吃掉整条工具行**，不适合当"按钮位"。

### 1.3 渲染位置与尺寸约束（来自内联 CSS，`CONV` 内 `InputBar.module.css`）

```css
/* 卡片：所有 slot 的定位基准 */
.RlGAzG_card{position:relative;box-sizing:border-box;width:100%;
  max-width:var(--dsh-composer-card-max-width);
  border-radius:var(--dsw-radius-panel);background:var(--dsw-specific-input-major);
  box-shadow:var(--dsw-elevation-soft);display:flex;flex-direction:column;
  gap:12px;padding-top:8px}

/* overlay slot 的锚点：0 高度、贴卡片顶边、占满宽 —— 子元素必须自己 absolute 定位 */
.RlGAzG_overlayAnchor{height:0;position:absolute;inset:0 0 auto}

/* 左侧工具行 / 右侧控件行 */
.RlGAzG_tools,.RlGAzG_modes{gap:12px}
.RlGAzG_trailing{flex:none;align-items:center;display:flex;gap:12px;margin-left:auto}
@container (width<=560px){.RlGAzG_tools,.RlGAzG_modes,.RlGAzG_trailing{gap:8px}}
.RlGAzG_add{width:28px;height:28px}                      /* 左侧图标按钮基准尺寸 */

/* activity：空则整块不占位；展开吃满整行 */
.RlGAzG_activity{flex:none;align-items:center;display:flex}
.RlGAzG_activity:empty{display:none}
.RlGAzG_activityExpanded{flex:1;min-width:0}
.RlGAzG_trailingActive{flex:1;margin-left:0}

/* 卡片内底部 dock 行 */
.RlGAzG_dock{display:flex;justify-content:center;align-items:center;gap:12px;
  max-width:100%;padding-top:4px}
```

补充：activity 展开时 `.tools` 被 `hidden: activity` 整行隐藏（`CONV:19042`），`standardControls` 同样（`CONV:19079`）——所以放在 `left`/`right` 的按钮在语音输入录音期间会消失，这是**可接受但要知道**的行为。

`conversation.input.dock` 的面板尺寸范式可照抄 TodoPanel（`CONV:19174` 的 `TodoPanel.module.css`）：

```css
/* TodoPanel.module.css 原文（token 已是最终形态，照抄即可） */
.panel{box-sizing:border-box;
  width:calc(100% - var(--dsh-composer-side-clearance)*2 - var(--dsh-composer-dock-inset)*4);
  max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset)*4);
  border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);
  box-shadow:var(--dsw-elevation-panel);border:0;flex:none;margin:0 auto;overflow:hidden}
```

### 1.4 组件收到的 props 形状（精确合成顺序）

`REND:773-790` 逐字：

```js
// REND:784-790
return jsx(Comp, {
  ...kit,                 // 标准 kit（见下）
  ...injected,            // 注册时 inject 的返回值
  ...slotInjected.props,  // ctx.slots.inject(同名 slot, ...) 的公共注入
  ...contextual,          // 注册时 inject 返回的 hooks 字段 → use<Name>()
  ...ownerProps,          // renderSlot(slot, ownerProps) 的第二个参数 —— 最后覆盖，插件改不动
});
```

`kit` 的构成（`REND:736-767`）：

- `standard`：`root` 标准 + 本 scope 标准（`REND:680-702`）
  - session 作用域标准 props（`SESS:756-762`）：`sessionId`（plain）、`useSession`（hook）、`useProjection(key)`（keyed hook）
  - `conversation.input.*` 还额外拿到 `ctx.uiSession.provide()` 提供的东西（`CONV:19709-19725`）：
    - `props: ["inputActions"]` → **`inputActions`**（plain prop）
    - `hooks: ["conversation", "input"]` → **`useConversation()` / `useInput()`**
- `t`：注册时写了 `locale: NS` 就有（`REND:742-746`）
- `useStore` / `actions`：注册时写了 `store` 才有
- `renderSlot` / `renderSlotChain` / `SessionProvider` / `renderFactorySlot`：注册时声明了 `children` 才有
- 注册里 `inject: (sessionId) => ({ hooks: {...}, ...props })` 返回的 `hooks` 会变成 `use<Name>`（`REND:667-677` + `VCON:2891-2893` 的 `hooks: { speechReadiness: readiness.state }` → 组件里 `useSpeechReadiness`）

**所以一个 `conversation.input.dock` 组件拿到的 props 至少是：**

```ts
{
  sessionId: SessionId
  session: SessionSnapshot          // 仅 input.dock 的 ownerProps 里有
  input: InputStateSnapshot         // 仅 input.dock 的 ownerProps 里有
  useSession: <T>(sel: (s) => T) => T
  useProjection: (key: string) => <T>(sel) => T
  useConversation: <T>(sel) => T
  useInput: <T>(sel) => T
  inputActions: InputActions
  t: (key: string, params?) => string
  renderSlot / renderFactorySlot
  ...你的 inject 返回的 props
  ...你的 inject 返回的 hooks 对应的 use<Name>
}
```

---

## 2. 草稿读写

### 2.1 组件内的公共面：`InputActions`（`ctx.uiSession.provide` 的 `inputActions`）

实现体 `CONV:14911-14938` 逐字：

```js
// CONV:14911-14938
/** The public provide-channel action face (one stable identity per session). */
actions = {
  captureInsertion: () => ({ ...this.caretSpan(), draftRev: this.rev }),      // 14913
  insertText: (text, span) => {                                               // 14917
    if (this.snapshot.phase === "adjudicating" || this.snapshot.phase === "submitting" || this.disposed) return false;
    if (span.draftRev !== this.rev) return false;
    return this.draftEditor.insertAsyncText(span, text);
  },
  setDraft: (text) => { this.setDraft(text); },                               // 14922
  persistDraft: () => { this.persistCurrentDraft(); },                        // 14925
  addAttachments: (ids) => this.addAttachments(ids),
  removeAttachment: (id) => { this.removeAttachment(id); },
  pruneAttachments: (ids) => this.pruneAttachments(ids),
  submit: () => { this.submit("queue"); },
};
```

| 方法 | 入参 | 返回 | 守卫 | 焦点/光标 |
|---|---|---|---|---|
| `captureInsertion()` | – | `{ start, end, draftRev }` | – | 只是读取，无副作用 |
| `insertText(text, span)` | `text: string`，`span` 必须来自 `captureInsertion()` | `boolean` | `phase` 必须是 `plain`/`claimed`；`span.draftRev === 当前 rev` | 光标落到插入文本**之后**；**不调用 focus()** |
| `setDraft(text)` | `string` 或完整语义草稿（含 references/command） | `void` | **无守卫**（`CONV:14922-14924` 不检查 phase） | 光标落到**文档末尾**；**不调用 focus()** |
| `persistDraft()` | – | `void` | – | 立即把当前草稿写进 Conversation store（`CONV:15072-15074`） |

`setDraft` 走的是同一个 Lexical editor（`CONV:14666-14688` `DraftEditor.setDraft`：`root.clear()` → 按 `\n` 切段 → `root.selectEnd()`，`tag: xo` 合并进 undo 历史），所以**不会被下一次渲染回滚**：编辑器是唯一真源，`publish()` 每次都从编辑器取 `projection` 再写 store（见 2.4）。

### 2.2 `InputState`（`useInput()` / `input.draft` 的形状）

`CONV:15676-15687` 逐字：

```js
compose() {
  const core = this.core.state;
  return {
    draft: this.projection.clipboardText,   // ← 建议喂给 LLM 的"全文"
    attachmentIds: this.attachmentIds,
    draftRev: this.rev,
    phase: core.phase,                       // "plain" | "claimed" | "adjudicating" | "submitting"
    ...core.claim !== void 0 ? { claim: core.claim } : {},
    occurrences: this.projection.occurrences, // chip（@file / @session）占位
    queue: this.deps.inbox?.getSnapshot()?.["next-turn"] ?? EMPTY_QUEUE$1,
  };
}
```

`phase` 分档见 `CONV:14876-14882`（`guardOf`）：`plain` → `plain`，`claimed` → `claimed`，其余 → `frozen`。

> **`draft` 是 clipboardText 形式**：引用 chip 已展开成 `@path` / `@[label](dsh-session:…)` 文本（`CONV:15064` `snapshotDraft(projection.clipboardText, …)`）。这正是我们要喂给模型的形态。

### 2.3 选区：**detect 坐标 vs draft 坐标的坑**

```js
// CONV:14710-14723  DraftEditor.caretSpan()
caretSpan() {
  if (this.projection.selection !== null) return this.projection.selection;
  const at = this.projection.detectText.length;
  return { start: at, end: at };
}

// CONV:14745  insertAsyncText —— 插入前先剔除引用占位符
const clean = text.replace(REFERENCE_PLACEHOLDER_RE, "");
```

`captureInsertion()` 返回的 `start/end` 是 **detect 坐标**（chip 在 detectText 里是 1 个 `U+FFFC`），而 `input.draft` 是 clipboardText。**草稿里没有任何 chip 时两者等长**，直接 `draft.slice(start, end)` 是对的。

- 需要 detectText：宿主侧有 `shell.projection`（`CONV:14941-14943` 的 `get projection()`），含 `{ clipboardText, detectText, selection, occurrences, command, caret }`（见 `CONV:14656`、`CONV:14792-14793` 的用法）。
- 组件内结论：**有 `input.occurrences.length > 0` 时，不要按 `input.draft` 切选区**；要么走宿主侧 `shell.projection.detectText`，要么降级为"整段优化"（推荐，spec 也允许）。

### 2.4 状态机 / 不被回滚

- 每次编辑 → `publish()`（`CONV:15688-15696`）：先 `state.set(compose())` 发布 `InputState`，再把 `draftSnapshot` 写进 Conversation store（`persistDraft?.(draft)`）。
- 草稿持久化由 `bindDraftPersistence` 绑定到 per-session store 的 `setDraft`（`CONV:4440` `setDraft: (d, text) => { d.draft = text; }`，`CONV:15403-15408`）。
- 结论：`inputActions.setDraft()` 与 `shell.setDraft()` 都只是"给编辑器下一次程序化写"，之后由 `publish()` 统一回流到 store —— **同一套状态机，不会被下次渲染回滚**。

### 2.5 真实调用链（voice-input，含 "Your draft changed" 冲突处理）

```js
// VCON:1941-1952  触发时立刻固化选区 + 版本
const start = async () => {
  const active = {
    capture: createRecording(),
    abort: new AbortController(),
    span: inputActions.captureInsertion(),   // ← 1947：{start,end,draftRev}
    ...
  };
};

// VCON:1928-1932  结果回来才尝试插入；失败 = 草稿变了
if (!inputActions.insertText(result.value.text, active.span)) {
  setPending(result.value.text);   // 结果不丢，挂在麦克风旁边
  feedback(t("conflict"));
  return;
}

// VCON:2045-2055  用户显式点「插入」→ 用**当前**光标重新取 span，插到光标处
if (inputActions.insertText(pending, inputActions.captureInsertion())) {
  setPending("");
  setPhase("idle");
}

// VCON:2311  文案
conflict: "Your draft changed. The transcript is preserved and can be inserted at the current cursor.",
```

**这是官方范式，直接照抄到「优化」插件**：

1. 触发时 `span = inputActions.captureInsertion()`，同时快照 `input.draft`（原文）。
2. 请求期间用户改了草稿 → 确认时 `insertText` 返回 `false` → **不静默覆盖**：按 spec §1 提供「仍然替换」（`setDraft`）与「插入到当前光标」（`insertText(result, captureInsertion())`），或提示重新优化。
3. 确认前再比对一次 `input.draft === 快照原文`，等价判断 + 更好的 UX（能在按钮上提前给提示，而不是点了才失败）。

### 2.6 宿主侧（快捷键路径）：`ctx.conversation.input.for(actx)` → shell

组件外（`apply` / 快捷键 `resolve` 里）没有 `inputActions`，但有**同源的 shell**：

```js
// CONV:17210-17218（queue dock 的真实 inject 用法）
inject: (sessionId) => {
  const actx = ctx.sessions.scope(sessionId);
  if (actx === void 0) throw new Error(`queue dock: session "${sessionId}" resolved no scope`);
  const conversation = actx.get("conversation");
  if (conversation === void 0) throw new Error("queue dock: conversation service unavailable");
  return {
    updateQueue: (itemId, action) => conversation.updateQueue(itemId, action),
    notify: (level, text) => conversation.input.for(actx).notify(level, text), // ← shell 在这里
  };
}
```

- 服务名：`conversation`（`CONV:180397-180415`：`class ConversationController extends Service` + `super(ctx, "conversation")` + 成员 `input`）。
- `conversation.input` 的接口（`CONV:15721-15749`）：`for(actx)`、`shellFor(binding)`、`shell(sessionId)`、`requestDraftInitialization(binding, opts)`。
- `for(actx)` 返回 **`SessionInputShell`**（`CONV:14901`），公开面：

| 成员 | 证据 | 说明 |
|---|---|---|
| `.actions` | `CONV:14912` | 就是组件里那份 `inputActions`（同一对象） |
| `.snapshot` | `CONV:15395-15397` | 同 `useInput()` 的快照 |
| `.setDraft(text)` | `CONV:15008-15019` | 支持 `{text, references, command}` 语义草稿 |
| `.caretSpan()` | `CONV:15256-15258` | detect 坐标选区 |
| `.projection` | `CONV:14941-14943` | `{clipboardText, detectText, selection, occurrences, command, caret}` |
| `.focus()` | `CONV:15362-15370` | **Lexical 原生 focus，光标回到草稿原位置**（不是 DOM focus） |
| `.notify(level, text)` | `CONV:15354-15360` | 走 composer 的 notice 横幅 |
| `.persistCurrentDraft()` | `CONV:15072` | 立即持久化 |
| `.insertText(text, span)` | `CONV:15345-15348` | `span.draftRev === rev` 才生效 |

**`focus()` 只在这里有，`inputActions` 里没有** —— 这是给快捷键路径 / 确认回填用的恢复焦点正解。

```js
// 推荐封装（放进 plugin 的 client apply 里）
function composerFor(ctx, sessionId) {
  const actx = ctx.sessions.scope(sessionId);
  if (actx === void 0) return undefined;
  const conversation = actx.get("conversation");
  if (conversation === void 0) return undefined;
  try {
    return conversation.input.for(actx);   // CONV:15739-15745，未保留的会话会 throw
  } catch {
    return undefined;
  }
}

// 整体替换 + 回焦
function replaceDraft(ctx, sessionId, text) {
  const shell = composerFor(ctx, sessionId);
  if (shell === undefined) return false;
  if (shell.snapshot.phase !== "plain" && shell.snapshot.phase !== "claimed") return false;
  shell.setDraft(text);        // CONV:15008
  shell.persistCurrentDraft(); // CONV:15072（保险，正常由 publish 触发）
  shell.focus();               // CONV:15367：光标回草稿原位置
  return true;
}
```

---

## 3. 快捷键（`dsh-client-shortcuts`）

### 3.1 注册 API（真实调用样例，`dsh-client-ui-workspace`）

```js
// dsh-client-ui-workspace\lib\client.js:91-122（逐字节选）
const register = (id, label, aliases, code, modifiers, webModifiers, resolve) => {
  ctx.effect(() => ctx.shortcuts.register({
    id,
    label,                                    // () => string（函数：跟着语言变）
    aliases,                                  // string[]（搜索别名）
    defaults: {
      "desktop:macos":   { code, modifiers },
      "desktop:windows": { code, modifiers },
      "desktop:linux":   { code, modifiers },
      "web:macos":       { code, modifiers: webModifiers },
      "web:windows":     { code, modifiers: webModifiers },
    },
    regions: ["page", "editable"],            // ← 必须含 editable 才能在输入框里触发
    modals: [],                               // 允许在哪些模态下触发
    resolve,
  }), `ui-workspace: ${id}`);
};
```

- 必须放进 `ctx.effect(...)`，返回 disposer（`practices.md:8`、`SKILL.md` 同义）。
- 省略某个平台配置 = 该平台不绑键（`README.zh.md:30`）。
- `modifiers` 支持 `"primary"`（macOS=Command，Windows=Control），按设备展开（`README.zh.md:30`）。
- 键用**物理 `code`**（`KeyP`、`Enter`、`Slash`…）。

### 3.2 `resolve` 的契约

`SHORT:1282-1331` 是唯一的裁决点：

```js
// SHORT:1319-1330
const resolution = command.resolve(context);
if (resolution.status === "pass") return resolution;                       // 不消费
consume();                                                                  // preventDefault
if (resolution.status === "blocked") return { ...resolution, commandId: command.id };
if (!gesture.repeat) resolution.run();
return { status: "handled", commandId: command.id };
```

所以 `resolve(context)` 返回三选一：

```ts
{ status: "pass" }                              // 让给别人
{ status: "blocked", reason: string }           // 吃掉按键但不做事
{ status: "handled", run(): void }              // 干活
```

`context` 的字段（`SHORT:1402` / `SHORT:1528` 采集，`SHORT:1301/1311` 消费）：`{ region, modal, target, ... , source }`，其中
`region` = `"terminal"` | `"editable"` | `"page"`，判定规则 `SHORT:1402`：

```js
const region = element?.closest(".xterm") ? "terminal"
  : element?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') ? "editable"
  : "page";
```

`target` 是原始 DOM 元素（含 shadow root 内元素）——**用它反查 session**，这是 composer 快捷键的唯一正解。官方范例 `installStopShortcut`（`CONV:19374` 起）：

```js
// CONV:19387-19405 略缩，逐字关键行
const target = context.target;
const occurrence = target.closest("[data-conversation-session]");
const region = target.closest("[data-conversation-region]");
if (occurrence === null || region === null || !occurrence.contains(region) || ...) { reset(); return; }
const sessionId = occurrence.dataset.conversationSession;
const binding = sessions.binding(sessionId);
if (binding === void 0) { reset(); return; }
input.consume();
```

→ 我们的 `resolve` 可以直接：

```js
resolve: (context) => {
  const el = context.target;
  const occurrence = el?.closest?.("[data-conversation-session]");
  const composerRegion = el?.closest?.('[data-conversation-region="composer"]');
  if (occurrence === null || occurrence === undefined) return { status: "pass" };
  if (composerRegion === null || composerRegion === undefined) return { status: "pass" };
  if (!occurrence.contains(composerRegion)) return { status: "pass" };
  const sessionId = occurrence.dataset.conversationSession;
  return { status: "handled", run: () => openPolishPanel(sessionId) };
},
```

### 3.3 是否自动进设置 UI

**是。** `dsh-client-ui-shortcuts` 渲染整份 catalog：`SHORT:1239-1260` 把 `effectiveShortcuts(definitions, config.document, runtime, platform)` 的结果带 `label`、`aliases`、`presentBinding().keys`、`aria` 发布出去；`SHORT:1250` 直接把 `command.aliases` 带出。用户覆盖存 `dsh.keybindings.v1`（Web，同源 localStorage）/ `userData/keybindings.json`（Desktop）（`README.zh.md:34`）。

### 3.4 冲突风险（必须避开）

固定（不可编辑）键位在这里登记（`CONV:19630-19690`）：

| id | 键 | 证据 |
|---|---|---|
| `fixed.newline`（Shift+Enter） | `Enter` + `shift` | `CONV:19628-19633` |
| `fixed.complementary` | `Enter` + `control` / `meta` | `CONV:19634-19649` |
| `fixed.slash` | `Slash`（无修饰） | `CONV:19650-19659` |
| `fixed.mention` | `Shift+Digit2`（`@`） | `CONV:19660-19669` |
| `response.stop` | `Escape`（连按两次，`stopSequenceMs` 默认 500ms） | `CONV:19673-19690` |

规则（`README.zh.md:32,36`）：**「这些组合参与冲突校验，不能分配给可编辑命令」**；同一修饰键集合下，单键与包含该键的双键也冲突；冲突的显式覆盖会被全部禁用。

→ 我们的默认键位取 **`primary + alt + KeyP`**（即 Ctrl+Alt+P / Cmd+Alt+P）：不与上表任何键冲突，也不与 workspace 的 `primary+KeyN` / `primary+KeyK` / `primary+alt+KeyG` 等冲突。注意 Web 上"理想的" `primary+KeyP` 可能与浏览器打印冲突，故用 `primary+alt`。

`README.zh.md:36` 还说明：**所有有效绑定优先于原生操作、编辑器、终端、内嵌页面和模态控件** —— 所以只要配置里绑上了，在 contenteditable 里就能收到（配合 `regions: ["page","editable"]`）。反过来说：**别绑裸字母键**，会把输入打死。

### 3.5 可直接粘的注册代码

```js
// lib/client.js 内，apply 里
function installPolishShortcut(ctx, openPanel) {
  const t = ctx.locale.bind("prompt-polish");   // dsh-client-ui-workspace\lib\client.js:88 同形
  const resolveSession = (context) => {
    const el = context.target;
    if (!el || typeof el.closest !== "function") return undefined;
    const occurrence = el.closest("[data-conversation-session]");
    const composer = el.closest('[data-conversation-region="composer"]');
    if (occurrence === null || composer === null || !occurrence.contains(composer)) return undefined;
    const sessionId = occurrence.dataset.conversationSession;
    return sessionId === undefined || sessionId === "" ? undefined : sessionId;
  };
  return ctx.effect(() => ctx.shortcuts.register({
    id: "prompt-polish.open",
    label: () => t("shortcut.open"),
    aliases: ["polish", "optimize prompt", "润色", "优化输入"],
    defaults: {
      "desktop:macos":   { code: "KeyP", modifiers: ["primary", "alt"] },
      "desktop:windows": { code: "KeyP", modifiers: ["primary", "alt"] },
      "desktop:linux":   { code: "KeyP", modifiers: ["primary", "alt"] },
      "web:macos":       { code: "KeyP", modifiers: ["primary", "alt"] },
      "web:windows":     { code: "KeyP", modifiers: ["primary", "alt"] },
    },
    regions: ["page", "editable"],
    modals: [],
    resolve: (context) => {
      const sessionId = resolveSession(context);
      if (sessionId === undefined) return { status: "pass" };
      return { status: "handled", run: () => openPanel(sessionId, "shortcut") };
    },
  }), "prompt-polish: open shortcut");
}
```

---

## 4. 面板渲染方案

### 4.1 推荐：`conversation.input.dock`

理由（全部有据）：

1. **位置正确**：`CONV:17842` 在 `composerStack` 里、`inputBar` 之前 → 整个 composer 卡片**上方**，与 spec §7「贴在 composer 上方」完全一致。
2. **`kind: "list"`** → 可以和 TodoDock（`order: 0`，`CONV:19301-19306`）、QueueDock（`order: 20`，`CONV:17205-17223`）共存，不抢位。
3. **有现成的面板视觉范式**：TodoPanel（`CONV:19174` 的 CSS）+ QueueDock（折叠头 + 列表 + 行内操作）就是"composer 上方面板"的标准做法，尺寸/圆角/阴影/elevation 都能直接抄 token。
4. `ownerProps` 额外给 `{ session, input }`（`CONV:17779-17782`）→ 直接拿到 `input.draft` / `input.draftRev` / `input.phase`，不用自己再订阅。

**`order` 取 40**（Todo=0，Queue=20，我们最上/最下都可，建议 40 靠后即更靠上，具体顺序按视觉调）。

### 4.2 备选：`conversation.input.overlay`（只用于"浮层"）

`CONV:18997-19001` 的锚点 `.overlayAnchor{height:0;position:absolute;inset:0 0 auto}` —— 0 高度、贴卡片顶边、`position:absolute`。渲染在这里的元素**必须自己 absolute 定位**（例如 `position:absolute;bottom:100%;left:0;right:0`）才能露出来，否则会压住卡片内容。适合做"轻量 popover"，不适合承载"三段 + 可编辑预览 + 两个按钮"这种有高度、要滚动的面板。

### 4.3 不推荐：`conversation.input.activity`

`kind: "single"`（`CONV:19912`）+ voice-input 已占（`VCON:2919`）+ 展开会隐藏 `.tools` / `standardControls` / ContextMeter（`CONV:19042/19079/19164`）。只有"录制/优化这种独占式交互条"才配它，而我们已经选了 dock 面板。

### 4.4 最小 React 组件骨架

**React 从哪来**：模块表（`FE:190`）里 `react`、`react/jsx-runtime` 都是 seed word；工厂里 `require("react")` 即可，**不要装第二份 React**（`ui-plugin.md:9`）。

```js
// @deepseek-ai/dsh-client-ui-primitives 也在表里（FE:190 的 SZ()），但——
// practices.md:35 明确要求：“Do not require('@deepseek-ai/dsh-client-ui-primitives') …
//   Write your own controls and match the host instead”
// 所以骨架里只用 react + 自己的 CSS。
```

```js
// lib/client.js —— 面板组件（可直接用，JSX 换成 jsx()/jsxs() 亦可）
window.__ModuleLoader__.load({
  id: "dsh-prompt-polish",
  factory(require) {
    const React = require("react");
    const { jsx, jsxs } = require("react/jsx-runtime");

    const LEVELS = [
      { id: "smooth", labelKey: "level.smooth" },
      { id: "structure", labelKey: "level.structure" },
      { id: "instruction", labelKey: "level.instruction" },
    ];

    /**
     * props（由宿主合成，见 §1.4）：
     *   sessionId, session, input, useSession, useProjection, useInput,
     *   inputActions, t, renderSlot,
     *   + inject 返回值：polish（hooks）+ open/close/confirm/cancel
     */
    function PolishPanel(props) {
      const {
        useInput, usePolish, t,
        open, level, phase, preview, notes, assumptions, error,
        setLevel, close, confirm, retry,
        canPolish,
      } = props;
      const input = useInput((v) => v);          // { draft, draftRev, phase, attachmentIds, occurrences }
      const ui = usePolish((v) => v);            // 插件自己的 UI 状态 store
      if (!open) return null;

      const busy = ui.phase === "loading";
      const disabledReason = !canPolish(input) ? t("hint.empty") : null;

      return jsxs("div", {
        className: "pp_root",
        "data-prompt-polish": true,
        children: [
          jsxs("div", {
            className: "pp_head",
            children: [
              jsx("span", { className: "pp_title", children: t("panel.title") }),
              jsx("div", { className: "pp_levels", role: "tablist", children: LEVELS.map((item) =>
                jsx("button", {
                  type: "button",
                  role: "tab",
                  key: item.id,
                  className: item.id === ui.level ? "pp_level pp_levelActive" : "pp_level",
                  "aria-selected": item.id === ui.level,
                  disabled: busy,
                  onMouseDown: (e) => e.preventDefault(),   // ← 保住编辑器焦点（VCON:1992-1994 同法）
                  onClick: () => setLevel(item.id),
                  children: t(item.labelKey),
                }, item.id),
              ) }),
              jsx("button", {
                type: "button",
                className: "pp_close",
                "aria-label": t("panel.close"),
                onMouseDown: (e) => e.preventDefault(),
                onClick: close,
                children: "×",
              }),
            ],
          }),
          disabledReason !== null
            ? jsx("div", { className: "pp_hint", role: "status", children: disabledReason })
            : busy
              ? jsx("div", { className: "pp_skeleton", "aria-hidden": true })
              : jsx("div", {
                  className: "pp_body",
                  children: [
                    jsx("div", {
                      className: "pp_preview",
                      role: "textbox",
                      "aria-multiline": true,
                      "aria-label": t("panel.preview"),
                      contentEditable: true,
                      suppressContentEditableWarning: true,
                      onInput: (e) => { /* 受控微调：把 e.currentTarget.textContent 记进 ui */ },
                      children: ui.edited,
                    }),
                    ui.notes.length > 0 && jsx("ul", { className: "pp_notes", children: ui.notes.map((line, i) =>
                      jsx("li", { key: i, children: line }) ) }),
                    ui.assumptions.length > 0 && jsx("div", {
                      className: "pp_assume",
                      role: "status",
                      children: [t("panel.assumptions"), " ", ui.assumptions.join("；")],
                    }),
                    error != null && jsx("div", { className: "pp_error", role: "alert", children: error }),
                  ],
                }),
          jsxs("div", {
            className: "pp_actions",
            children: [
              error != null && jsx("button", {
                type: "button", className: "pp_btn",
                onMouseDown: (e) => e.preventDefault(), onClick: retry,
                children: t("panel.retry"),
              }),
              jsx("button", {
                type: "button", className: "pp_btn",
                onMouseDown: (e) => e.preventDefault(), onClick: close,
                children: t("panel.cancel"),
              }),
              jsx("button", {
                type: "button", className: "pp_btn pp_primary",
                disabled: busy || disabledReason !== null || ui.edited === "",
                onMouseDown: (e) => e.preventDefault(), onClick: confirm,
                children: t("panel.confirm"),
              }),
            ],
          }),
        ],
      });
    }

    return { inject: ["slots", "shortcuts", "locale", "sessions", "remote"], apply(ctx) { /* 见 §6 */ } };
  },
});
```

要点：

- **每个按钮都 `onMouseDown: (e) => e.preventDefault()`** —— voice-input 的生产代码就这么保焦点（`VCON:1992-1994`）。编辑器保持 focus 时 `setDraft`/`insertText` 之后光标在正确位置且仍可继续打字。
- 预览区**可编辑**（spec §4「允许用户在预览里微调后再插入」）→ 用 `contentEditable` 而不是 `InlineEditor`（`InlineEditor` 是宿主内部件，props 为 `{value, label, onChange(text), onSave(), onCancel()}`，见 `CONV:16998-17012`，官方不建议 require）。
- 面板内 `Esc` 关闭：**不要**注册成固定键位（`Escape` 已被 `response.stop` 的 `Esc Esc` 占用，`CONV:19673-19690`）。用面板自己的 `onKeyDown`（React 冒泡）或 `useEffect` 里挂 `document.addEventListener("keydown")` 并在 open 时生效 —— 与 `VCON:1874-1879` 同一手法。
- `Ctrl/Cmd+Enter` 确认：同理在面板内 `onKeyDown` 判断（`event.key === "Enter" && (event.ctrlKey || event.metaKey)`），**不要**注册成全局快捷键（`fixed.complementary` 已占 `Enter+primary`，见 `CONV:19634-19649`）。

### 4.5 样式策略（最小可用）

1. **只用 token**：`--dsw-alias-*`（107 个，见 `dsh-client-ui-theme\lib\client.js`）、`--dsw-radius-{xs,sm,md,lg,xl,panel}`、`--dsw-elevation-*`、`--dsh-composer-{card-max-width,side-clearance,dock-inset,text-max-height,content-font-size}`。
2. **类名加自己前缀**（`pp_` / `Polish_`），不要复用宿主的 `RlGAzG_*`（那是构建期 hash，升级即变）。
3. **样式注入**：在 factory 执行期间 append 一个 `<style data-plugin-css="…">`，loader 会自动认领给本插件并在失效时移除（`MODS:618-629` `claimStyles`，`MODS:812-825` 在 `materialize` 里 `untaggedStyles()` → `claimStyles(ownerId, before)`）：

```js
// 放在 factory 顶部（组件定义之前），等价于宿主自己的做法 CONV:17229-17236
const CSS = `
.pp_root{box-sizing:border-box;
  width:calc(100% - var(--dsh-composer-side-clearance)*2 - var(--dsh-composer-dock-inset)*4);
  max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset)*4);
  margin:0 auto;border-radius:var(--dsw-radius-lg);
  background:var(--dsw-specific-menu);box-shadow:var(--dsw-elevation-panel);
  color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;
  display:flex;flex-direction:column;gap:8px;padding:10px 12px;overflow:hidden}
.pp_head{display:flex;align-items:center;gap:10px}
.pp_title{font-weight:500;flex:none}
.pp_levels{display:flex;gap:4px;background:var(--dsw-alias-bg-module-platform);
  border-radius:var(--dsw-radius-md);padding:2px}
.pp_level{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  border-radius:var(--dsw-radius-sm);padding:2px 10px;font:inherit;cursor:pointer}
.pp_level:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pp_levelActive{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.pp_close{margin-left:auto;appearance:none;border:0;background:transparent;cursor:pointer;
  color:var(--dsw-alias-label-tertiary);border-radius:var(--dsw-radius-sm);width:24px;height:24px}
.pp_body{display:flex;flex-direction:column;gap:6px;min-height:0}
.pp_preview{max-height:40vh;overflow:auto;white-space:pre-wrap;word-break:break-word;
  border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);
  padding:8px 10px;outline:none}
.pp_notes{margin:0;padding-left:18px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.pp_assume{color:var(--dsw-alias-label-tertiary);font-size:12px}
.pp_error{color:var(--dsw-alias-label-deep-diving);font-size:12px}
.pp_actions{display:flex;justify-content:flex-end;gap:8px}
.pp_btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:transparent;
  color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-md);
  padding:4px 12px;font:inherit;cursor:pointer}
.pp_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pp_primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;
  color:var(--dsw-alias-button-contrast-fill)}
.pp_primary:hover{background:var(--dsw-alias-button-primary-hover)}
.pp_skeleton{height:64px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-skeleton)}
`;
if (typeof document !== "undefined" &&
    document.querySelector('style[data-plugin-css="dsh-prompt-polish/panel.css"]') === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-prompt-polish";
  tag.dataset.pluginCss = "dsh-prompt-polish/panel.css";
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
```

> 注意：`--dsw-alias-button-contrast-fill` 是主按钮上的文字色（宿主 `Button` 的表现），若观感不对就退回 `--dsw-alias-label-inverted` 之类，先按实机截图校准。

### 4.6 工具栏按钮（`conversation.input.left`）

```js
ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
  name: "conversation.input.left",
  id: "prompt-polish",
  order: 10,
  locale: NS,
  inject: () => ({ hooks: { polish: polishStore }, openPolish }),
}, PolishTrigger));
```

```js
function PolishTrigger({ useInput, usePolish, t, openPolish }) {
  const can = useInput((v) => v.phase === "plain" && v.draft.trim() !== "" && v.attachmentIds.length === 0);
  const open = usePolish((v) => v.open);
  return jsx("button", {
    type: "button",
    className: "pp_trigger",
    "aria-label": t("trigger.aria"),
    "aria-expanded": open,
    disabled: !can,
    title: can ? t("trigger.title") : t("trigger.disabled"),
    onMouseDown: (e) => e.preventDefault(),     // ← 焦点留在编辑器
    onClick: () => openPolish(undefined, "button"),  // undefined = 用 focus 所在的会话
    children: jsx("span", { "aria-hidden": true, children: "Aa" }),
  });
}
```

尺寸对齐 `.RlGAzG_add`：`width/height: 28px`、`border-radius: var(--dsw-radius-md)`、hover 用 `--dsw-alias-interactive-bg-hover`（见 §1.3 的 `.card` / `.add` 规则与 `EnterBehaviorRow` 的 `.selector:hover` 写法 `CONV:17228`）。

---

## 5. 会话上下文与边界处理

### 5.1 能拿到什么

| 需要 | 取法 | 证据 |
|---|---|---|
| `sessionId` | plain prop（session 作用域标准 props） | `SESS:756-762`；`VCON:1832` 就是这么解构的 |
| 会话快照 | `useSession((s) => …)` | `SESS:760`（`hooks: { session: binding.session }`）|
| 当前模型 | `useProjection("modelSelection")((m) => m?.next ?? m?.lastUsed)` → `{ provider, model, reasoningEffort? }` | `CONV:15765-15774`（宿主自己就是这么算 `state.model` 的）；projection 键名 `"modelSelection"` |
| 投影其它键 | `useProjection("plan")` / `"goal"` / `"todos"` | `CONV:15766-15767`、`13290` |
| 语言 | 组件里 `t`（`locale: NS`）；宿主侧 `ctx.locale.getSnapshot().active` → `"zh"` \| `"en"` | `REND:742-746`；`dsh-client-locale\lib\client.js:1531,1250` |
| 草稿全文 | `input.draft` / `useInput((v) => v.draft)` | `CONV:15679` |
| 草稿版本 | `input.draftRev` | `CONV:15681` |
| 附件 | `input.attachmentIds.length` | `CONV:15680` |
| 是否可写 | `input.phase`（`plain`/`claimed` 才可写） | `CONV:14876-14882`、`14918` |

```js
// 触发本次优化时采集"上下文信封"（供 host LLM 调用 & 后置校验）
function captureContext(input, useProjection, t) {
  const model = useProjection("modelSelection")((m) => m?.next ?? m?.lastUsed ?? null);
  return {
    text: input.draft,
    draftRev: input.draftRev,
    occurrences: input.occurrences.length,     // chip 数量：>0 时不要按 draft 切选区
    locale: /* ctx.locale.getSnapshot().active，或传 t 的命名空间侧默认 */ "zh",
    model: model === null ? undefined : { provider: model.provider, name: model.model },
    level: /* 上次档位（persist store） */ "structure",
  };
}
```

### 5.2 边界：输入框为空 / 只有附件

- **纯空白**：宿主自己就用 `draft === "" && attachments.length === 0 && !claimActive` 决定占位符（`CONV:19035`），并且"没有附件的纯空白草稿无法发送"（`README.zh.md:97`）。我们的 `canPolish` 用 `input.draft.trim() !== ""`。
- **只有附件**（`draft === "" && attachmentIds.length > 0`）：没有可优化的文本 → 按钮禁用 + tooltip 说明（spec §1 已定）。注意**别把附件内容也喂给模型**：`draft` 里只有文本，附件是 `attachmentIds`。
- **命令 chip**：`input.claim !== undefined` 时草稿开头是 `/command` chip。`setDraft` 会 `cancelCommandRestore()` 并可能重建 chip（`CONV:15008-15019`、`15335-15054`）；**优化这类草稿要小心**：`draft` 里 `/goal ` 是字面 token，改写它等于改命令。建议：`input.claim !== undefined` 时禁用或只优化 chip 之后的参数段。
- **`phase` 非 `plain`/`claimed`**（`adjudicating` / `submitting`）：`insertText` 会直接 `false`（`CONV:14918`）；`setDraft` **不会**拦（无守卫）→ 必须自己在 `confirm` 前判 `input.phase`，否则可能在提交事务中改草稿。
- **超长**：按 spec §1 截断到 8000 并提示。
- **会话切换**：`shell` 是按 `binding` 缓存的（`CONV:15757-15759`），`for(actx)` 在未保留会话会 throw（`CONV:15743`）→ 我们的 `composerFor` 已 try/catch 返回 `undefined`，面板应随之关闭。

---

## 6. 附：插件包骨架与加载契约（跨任务共享）

### 6.1 `lib/client.js` 的封装格式（不是普通 ESM！）

浏览器半区必须写成 `window.__ModuleLoader__.load({ id, factory })`；`id` **必须等于包名**（`client-modules` 的报错原文：`bundle ${url} loaded without registering "${id}" via __ModuleLoader__.load`，`MODS:758`）。

```js
// 事实：MODS:817 —— exports 就是 factory 的返回值
//   exports: registered.factory(this.makeRequire(ownerId, edges))
window.__ModuleLoader__.load({
  id: "dsh-prompt-polish",
  factory(require) {
    const React = require("react");
    ...
    return { inject: [...], apply(ctx) {...} };     // ← 模板 SKILL/templates/decoration/client.js:13-21 同构
  },
});
```

`require(spec)` 的解析顺序（`MODS:832-841`）：模块表 seed（`FE:190` 的 `SZ()`）→ 已物化模块 → 已注册 factory → 否则抛
`require("…") missed the module table`。

**模块表（`FE:190`，逐字）**：

```js
{
  react, "react/jsx-runtime", "react-dom", "react-dom/client",
  "@deepseek-ai/cordis", zod, "@tanstack/react-virtual",
  "@deepseek-ai/dsh-client-store", "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives", "@deepseek-ai/dsh-client-ui-dockkit",
}
```

即**只有这 11 个**裸 specifier 是免费可用的；其他（含 `@deepseek-ai/dsh-client-ui-conversation`）要靠 `dsh.client.external` 或已注册的包 factory —— 而 `practices.md:35` 明确不要这么干（"they change without notice, a plain-JS plugin has no type check, and a throwing component blanks your slot entry"）。

### 6.2 `dsh.client` 清单字段（`VCON:package.json:62-78`、`SKILL/templates/decoration/package.json:13-20`）

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "immediately": true,
    "inject": ["@deepseek-ai/dsh-client-ui-conversation"],
    "external": ["@deepseek-ai/dsh-api-gateway/client"]
  }
}
```

- `inject`：只用于**激活顺序**，不代表能 require（`practices.md:35`）。
- `external`：模块表之外的精确请求，需宿主侧有对应动态包 row（`dsh-client-modules\README.zh.md:34,51`）。
- ⚠️ 现有 `plugin/package.json` 缺 `"immediately": true` —— 与官方模板不一致，若面板不出现优先查这里（**未验证**，交由 task-3 实证）。

### 6.3 会话作用域服务怎么拿（面板注册用）

```js
slots.register({
  name: "conversation.input.dock",
  id: "prompt-polish",
  order: 40,
  locale: NS,
  inject: (sessionId) => {
    const actx = ctx.sessions.scope(sessionId);              // CONV:17211 同法
    const conversation = actx?.get("conversation");          // CONV:17213
    const shell = (() => { try { return conversation?.input.for(actx); } catch { return undefined; } })();
    return {
      hooks: { polish: polishStore },                        // → usePolish
      openPolish: (level) => openFor(sessionId, level),
      confirm: (text) => {
        if (shell === undefined) return false;
        if (shell.snapshot.phase !== "plain" && shell.snapshot.phase !== "claimed") return false;
        shell.setDraft(text);                                // CONV:15008
        shell.persistCurrentDraft();                         // CONV:15072
        shell.focus();                                       // CONV:15367 ← 唯一的回焦正解
        return true;
      },
      insertAtCaret: (text) => shell?.actions.insertText(text, shell.caretSpan()) ?? false,
      draftNow: () => shell?.snapshot.draft ?? "",
    };
  },
}, PolishPanel);
```

---

## 7. 未定 / 需要实证的项

| 项 | 状态 | 已知替代方案 |
|---|---|---|
| `conversation.input.left` / `right` 注册是否会在 activity 展开时被整行 `hidden` | **确定会**（`CONV:19042/19079` 的 `hidden: activity`）；但"按钮被隐藏时面板是否还能打开"未实测 | 面板本身在 `input.dock`，不受影响；按钮消失期间快捷键仍可用 |
| `kind: "list"` 的 `order` 相同值如何排序 | 未定（`slots` 包在 `FE` 里已打包，源码不可读） | 取互不相同的 `order`（我们有 40，Todo=0，Queue=20） |
| 预览区 `contentEditable` 的受控写法在 IME 下的表现 | 未实测 | 退化为只读预览 + 「插入后由用户自己改」（宿主 `InlineEditor` 也是这个思路，`CONV:16998-17012`） |
| 面板内 `Tab` 在档位间切换是否会与宿主 composer 键盘映射冲突 | 未实测（宿主 composer 的 Tab 归斜杠菜单流水线，`README.zh.md:97`） | 面板自己 `onKeyDown` + `preventDefault`；不行就改成 `←/→` |
| `--dsw-alias-button-contrast-fill` 作主按钮文字色是否正确 | 未实测（无实机截图） | 参考 `EnterBehaviorRow.module.css` 的 `.selector`（`CONV:17228`）自行校准 |
| `plugin/package.json` 缺 `immediately: true` 的影响 | 未验证 | 见 §6.2，交由 task-3 的 hello-world 实证 |
| 宿主 `Escape`（`Esc Esc` 停轮）与面板 `Esc` 关闭是否互相干扰 | 逻辑上：面板的 `onKeyDown` 在捕获阶段 `stopPropagation` 即可隔离；**未实测** | 面板关闭后再让 `Esc` 冒泡 |

---

## 9. 补漏核对（Lead 提问 a/b/c，逐条给证据）

### a) dock 的 `inject` 工厂收到什么 + list slot 的 `order` 语义

**收到 sessionId（已证实）**：`REND:435-442`

```js
function runInject(entry, binding, actions) {
  const inject = entry.inject;
  if (!inject) return EMPTY_INJECTED_PROPS;
  const args = [];
  if (binding !== void 0) args.push(binding.key);   // ← scope 绑定的 key
  if (actions !== void 0) args.push(actions);       // ← 只有声明了 store 才有第二参
  return bindInjectSources(inject(...args));
}
```

session 作用域的 `binding.key` 就是 **sessionId**：`REND:697` 用 `scopeBinding.key` 作为 keyed hooks 的 defaultKey，而 `CONV:17210-17213` 的 queue dock 直接把形参当 sessionId 用 `ctx.sessions.scope(sessionId)`；`CONV:19921` 的 `conversation.composer.bar`（`session-maybe`）则是 `inject: (sessionId) => { if (sessionId === void 0) … }`。
→ `conversation.composer.dock` 与 `conversation.input.dock` 都是 `scope: "session"`（`CONV:19916` / `CONV:19750`），`inject(sessionId)` **一定**收到字符串 sessionId，不会 `undefined`。
返回值的 `hooks: {…}` 会被转成 `use<Name>`（`REND:444-452`），其余字段原样作为 props（`REND:786`）。

**order 语义（已证实）**：`REND:1218`

```js
let list = [...rows].sort((a, b) => a.order - b.order);
```

**升序**：`order` 越小越靠前（DOM 顺序 = 视觉从上到下）。`order` 相同则保持注册顺序（`Array.prototype.sort` 稳定）。
实测数字：TodoDock `order: 0`（`CONV:19304`）、QueueDock `order: 20`（`CONV:17208`）→ Todo 在上、Queue 在下。我们取 `order: 40` 即排在两者之下（更贴近输入卡片）。

### b) `insertText` 被拒时的相位字符串（UI 直接用这几个）

取值集合来自 `guardOf`（`CONV:14876-14882`）：

```js
switch (phase) {
  case "plain": return "plain";
  case "claimed": return "claimed";
  default: return "frozen";
}
```

**`InputState.phase` 的准确字符串只有四个**：`"plain"`、`"claimed"`、`"adjudicating"`、`"submitting"`（`CONV:15682` 直接把 `core.phase` 透出；`CONV:15947/15994/15107` 都用这两个词做 `adjudicating` / `submitting` 判定）。

`insertText` 返回 `false` 的条件（`CONV:14918-14920`）逐字：

```js
if (this.snapshot.phase === "adjudicating" || this.snapshot.phase === "submitting" || this.disposed) return false;
if (span.draftRev !== this.rev) return false;
```

→ **"提交中/裁决中" = `phase === "adjudicating"`（裁决/命令解析）与 `phase === "submitting"`（已提交在途）**；另加 `disposed`。
UI 建议：`phase` 为这两个值时按钮置灰并显示"发送中…"（宿主 QueueDock 的文案就是 `t("queue.sending")`，`CONV:16973-16975`）。
⚠️ `setDraft` **没有**这层守卫（`CONV:14922-14924`），必须自己判 `phase`。

### c) 两个 dock slot 的 DOM 位置（决定"贴上方"该用哪个）

```
ConversationRoot
└─ div.composerStack                      // CONV:17834-17845
   ├─ renderSlot("conversation.input.dock", zone)   // ★ 17842 —— 在 inputBar 之前 = 整个输入卡片【上方】
   ├─ renderSlot("conversation.composer.bar", …)    // 17820/17843 —— 输入卡片本体（div.card）
   │  └─ div.card.RlGAzG_card[data-composer-card]   // CONV:18987-19169，position:relative
   │     ├─ div.overlayAnchor[data-composer-overlay]  // 18997-19001，absolute/height:0 贴卡片顶边
   │     ├─ (accessory)                               // 19002-19005
   │     ├─ renderSlot("conversation.input.attachments")
   │     ├─ DraftEditor（编辑器）
   │     ├─ div.row（工具行：tools / trailing / activity / send）
   │     └─ div.dock[data-composer-dock]              // ★ 19161-19168 —— 卡片【内下沿】一行
   │        ├─ renderSlot("conversation.composer.dock")   // 19164
   │        └─ ContextMeter（成本/上下文圆环，同一行并排） // 19164
   └─ composerSeat                        // 17855 起
```

结论：

- **要"贴在输入框卡片上方"→ 用 `conversation.input.dock`**（`CONV:17842`，在 `composerStack` 内、`inputBar` 之前；TodoDock/QueueDock 就在这里）。
- `conversation.composer.dock` 在**卡片内部、工具行（发送按钮那行）之下**，与 `ContextMeter` 同一行（`div.RlGAzG_dock{justify-content:center;gap:12px;padding-top:4px}`）——它是"卡片底栏"，不是"卡片上方"。成本圆环（`cm-corner` 类那一族）就是紧挨着它的同排邻居。
- `conversation.input.overlay` 的锚点 `height:0; position:absolute; inset:0 0 auto`（`CONV` 内 `InputBar.module.css`，配 `CONV:18997-19001`）→ 贴卡片**顶边**的浮层锚点，子元素必须自己 absolute 定位。

---

## 8. 一句话给实现者

> 面板注册 `conversation.input.dock`（`id: "prompt-polish"`, `order: 40`），按钮注册 `conversation.input.left`；草稿全文读 `input.draft`，整体回填用 inject 里的 `shell.setDraft()` + `shell.focus()`（或组件内 `inputActions.setDraft()` + 按钮 `onMouseDown` 保焦点），要精确到选区就用 `captureInsertion()`/`insertText()` 并接受 `draftRev` 守卫的 `false` 语义；快捷键 `primary+alt+KeyP`、`regions: ["page","editable"]`、`target.closest("[data-conversation-session]")` 定位会话；样式只用 `--dsw-alias-*` token，样式表在 factory 里自注入。
