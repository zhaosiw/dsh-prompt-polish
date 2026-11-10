# dsh-prompt-polish

> DSH（DeepSeek Harness）输入框的「一句话变好指令」插件：点一下输入卡片里的 **★**，你随手写的草稿当场被重写成更清楚的指令，直接落在输入框里；不满意点「撤销」就一字不差地回来。

交互照 TRAE 的「优化输入内容」做：**一个星星图标、没有任何选项、点完就用**。比它多三件事——**保持你的原语言**、**可撤销**、**有快捷键**。

![one click](https://img.shields.io/badge/one%20click-%E2%98%85-9b6cff) ![platform](https://img.shields.io/badge/platform-DSH%20Web%20GUI-informational) ![license](https://img.shields.io/badge/license-MIT-green)

## 怎么用

```
输入卡片底部  ★      点一下 → 草稿被改写 → 直接替换原文 → 上方浮出「已优化｜撤销」
快捷键        Ctrl/Cmd + Alt + P    （焦点在输入框里时直接按）
```

- 星星**只有图标、没有文字**，位置在输入卡片底部工具行、模型名左侧（`conversation.input.right`）
- 输入为空时是灰的，点不动；模型正在回话（提交 / 裁决中）也会置灰
- 提示条 12 秒后自动消失；期间点「撤销」精确还原点击前的草稿
- 没有任何档位、菜单、面板要你选——改多深由模型看你的草稿自己判断

## 改多深（内部判断，你不用选）

| 你的草稿 | 它会做的事 |
| --- | --- |
| 已经说清楚了 | 只修语法、标点、口语和赘词，句子顺序基本不动 |
| 想法清楚但约束含糊 | 补齐背景、范围、输出形式、禁止项、验收标准，该分点就分点 |
| 只是一堆零散念头 | 重组成「要做什么 / 现状 / 要求 / 不要做什么」，让人一眼能开工 |

宁短不长：成品控制在原文 1.5 倍以内；一句话能说清的不加小标题、不加清单。

## 保真优先

- **不动本意**：不新增事实、参数、需求，不删信息点，不改意图与优先级
- **逐字保留**：`@引用`、`/命令`、代码与行内代码、URL、路径、环境变量、标识符、命令参数、数字与单位、引号内原文
- **保持原语言**：中文进中文出（TRAE 会把中文描述改成英文，这里不会）
- **绝不写裸 JSON**：模型输出被 `maxTokens` 截断时，先从 `"text": "…"` 里抢救正文；连正文都取不到就报错，绝不把半截 JSON 塞进输入框
- **不产生对话**：优化走的是独立的 LLM 调用，不写 Session、不占对话轮次

## 安装

> 前提：DSH Web GUI 已能正常使用，profile 目录可写，`pnpm` 在 PATH。

```powershell
# 1) 装进正在运行的那个 profile（把 <profile> 换成 desktop 或 web）
pnpm --dir "$env:USERPROFILE\.dsh\profiles\<profile>" add "github:zhaosiw/dsh-prompt-polish"

# 2) 让 profile 组合它：编辑 <profile>/package.json 的 dsh.profile.bundles，追加 "dsh-prompt-polish"

# 3) 触发一次 profile 重组（宿主 dsh-hmr 监听 patch/manifest，约 2~3 秒）
Add-Content "$env:USERPROFILE\.dsh\profiles\<profile>\cordis.patch.yml" "`n# touch $(Get-Date -Format o)"
```

宿主会**热重组**：不用重启宿主，连页面刷新都不用（新行经 `/plugins/events` SSE 推给已打开的页面）。

仓库里的 `scripts/install.ps1` 把这三步做成幂等脚本（自动探测在跑的 profile、改前备份、失败自动回滚）：

```powershell
pwsh -File .\scripts\install.ps1
pwsh -File .\scripts\uninstall.ps1                  # 回滚
node .\scripts\verify.mjs dsh-prompt-polish 61749   # 只读验证：模块图有该行 + bundle 200
```

## 工作原理

两个半区，一个包：

```
lib/index.js        宿主半区：ctx.provide('promptPolish')，把草稿交给 llm 流式改写
lib/typert.host.js  Typert 清单：声明 promptPolish/polish 这条 RPC（codec 用 create() 工厂，零第三方依赖）
lib/client.js       浏览器半区：手写 __ModuleLoader__ 成品 bundle —— 星星 + 提示条 + Remote 挂载
cordis.patch.yml    组合包补丁：insert 一行 prompt-polish
```

- 入口挂在 `conversation.input.right`（输入卡片底部工具行内，`order: 10`，模型名左侧）；**不**在卡片外面的 dock 上
- 这个 slot 拿不到 `props.input` 快照，草稿要读注入的 hook：`props.useInput((s) => s)`；写回用 `inputActions.setDraft(text)`，撤销就是 `setDraft(点击前快照)`
- RPC：客户端把 `createTypertRemoteInfo` 等价的清单 `$mount` 进 `ctx.remote`，然后 `ctx.inject(['remote.promptPolish'], …)` 注入命名空间，之后调 `ctx.remote.promptPolish.polish({ text, level, locale })`，返回 `{ ok, value } | { ok, error }`
  - `level` 是**兼容字段**：宿主已不读它（深度由模型判断），但带上它是为了兼容 compose 期就固化下来的旧 typert 注册表——见下方「已知边界」
- 模型：跟随 `agent-default-model` 当前选择；`prepareCall` 优先关掉 reasoning，被拒自动退回默认档；输出约定为 `{"text","notes","assumptions"}` 一行 JSON
- 预算按草稿长度给：`min(4200, max(600, len*2.2 + 320))` tokens；撞上 `maxTokens` 自动放大预算重发一次；超时 60 秒

更细的实现调研（带行号证据）在 `docs/`：

| 文档 | 内容 |
| --- | --- |
| [docs/spec.md](docs/spec.md) | 设计与提示词全文（判断深度规则、保真清单、输出协议、降级表） |
| [docs/composer-api.md](docs/composer-api.md) | composer slot 全表、草稿读写 API、快捷键注册、相位字符串 |
| [docs/host-llm.md](docs/host-llm.md) | 客户端→宿主 Remote、LLM 流式调用、为什么零 Session 写入 |
| [docs/deploy.md](docs/deploy.md) | profile 热重组机制与实证、安装/回滚的坑 |

## 验证

```bash
node test/host-smoke.mjs        # 假 llm 跑 9 个分支：正常/降级/非 JSON/截断抢救/超预算重发/半 JSON 护栏/空输入/无 llm/无模型
node test/probe-manifest.mjs    # 用官方 validateTypertManifest 校验清单
node test/probe-host-load.mjs   # 在真 cordis 里加载宿主半区，断言服务与 typertRemote 标记
node test/cdp-verify.mjs        # headless Chromium + CDP 驱动真实 GUI 跑完整链路
```

`cdp-verify` 会：输入草稿 → 核对星星位置（在 `standardControls` 内、卡片内、编辑器下方、无文字、24×24）→ 点 ★ → 等提示条并核对回填 → 点「撤销」核对精确还原 → 按 `Ctrl+Alt+P` 再跑一遍 → 清空收尾，结果写 `test/shots/report.json`，截图存 `test/shots/`（已 gitignore）。`PP_DRAFT='你的草稿' node test/cdp-verify.mjs` 可换草稿复测。

它需要访问本机 GUI：`/` 与 `/api` 带会话 cookie 鉴权，脚本用 `~/.dsh/.credentials.yaml` 里的签名密钥现签一个（`test/mint-cookie.mjs`），只在本机运行、不读取任何模型密钥。

## 已知边界

- 优化用的是当前默认模型；没有可用模型时提示「请先在设置里选择模型」
- 延迟主要看模型：本机实测 30 字以内 3~5 秒，长草稿更久；关掉 reasoning 已经是最快路径
- 就地替换会覆盖草稿，撤销窗口只有 12 秒（提示条消失后就回不去了，重要指令先自己复制一份）
- **`lib/typert.host.js` 的改动要重启 DSH 才生效**：宿主半区代码（`lib/index.js`）跟着 profile 热重组就走，但 Typert 的 descriptor 注册表在 compose 期固化并被缓存。所以客户端调用时仍带 `level` 字段，兼容旧注册表
- 输入框内换行会被 Lexical 渲染成段落，`innerText` 读起来会多空行，实际段落结构是一行一段
- 按 DSH「模型可见输入应能从会话日志重建」的约定，本插件故意不落 Session；需要留痕时手动复制
- 只在 DSH `0.2.1-rc.2`（Web GUI / desktop profile）上实测；客户端 slot 名与 Remote 形态可能随版本变化

## License

MIT © zhaosiw
