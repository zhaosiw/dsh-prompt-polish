# dsh-prompt-polish

> DSH（DeepSeek Harness）输入框的「一句话变好指令」插件：点一下 **★**，你随手写的草稿当场被重写成更清楚的指令，直接落在输入框里，不满意点「撤销」就回来。

交互照着 TRAE 的「优化输入内容」做：**一个星星图标、没有选项、点完就用**；比它多三件事——**保持你的原语言**、**一键撤销**、**需要时先预览再确认**。

![一键优化](https://img.shields.io/badge/one%20click-%E2%98%85-9b6cff) ![platform](https://img.shields.io/badge/platform-DSH%20Web%20GUI-informational) ![license](https://img.shields.io/badge/license-MIT-green)

## 怎么用

```
输入卡片右上角  ★      点一下 → 草稿被优化 → 直接替换 → 提示条「已优化 · 中度 · 2.2s｜撤销｜详情」
快捷键          Ctrl/Cmd + Alt + P
长按 ★ 或右键   → 菜单：智能 / 轻度 / 中度 / 重度 / 直接回填 / 先预览
```

- 输入为空时星星是灰的，点不动；模型正在回话（提交/裁决中）也会置灰
- 提示条 12 秒后自己消失；期间点「撤销」一字不差回到你原来的草稿，点「详情」看这次改了什么、补了哪些假设

## 四档（默认「智能」，你不用选）

| 档位 | 做什么 | 什么时候自动用 |
| --- | --- | --- |
| 智能 `auto` | 按草稿自己选下面三档之一，不额外请求 | 默认 |
| 轻度 `smooth` | 只修语法、错别字、标点、赘词、指代与衔接 | ≤42 字且 ≤2 行 |
| 中度 `structure` | 把隐含结构显式化：该分点的分点，该补的范围/输出格式/禁止项补明确 | ≤220 字且 ≤6 行 |
| 重度 `instruction` | 重组成一条可执行指令：目标 / 范围 / 要求 / 禁止项 / 验收标准 | 更长、更散的草稿 |

## 保真优先

- **不动本意**：不新增事实、参数、需求，不删信息点，不改意图与优先级
- **逐字保留**：`@引用`、`/命令`、代码与行内代码、URL、路径、环境变量、标识符、命令参数、数字与单位、引号内原文
- **保持原语言**：中文进中文出（TRAE 会把中文描述改成英文，这里不会）
- **丢了会喊**：客户端再校验一遍上面那些 token，缺了就在面板里列出来，不静默吞掉
- **绝不写裸 JSON**：模型输出被截断时从 `"text"` 字段抢救正文；连正文都取不到就报错，不会把半截 JSON 塞进输入框

## 两种落地方式

| 模式 | 行为 | 适合 |
| --- | --- | --- |
| 直接回填（默认） | 结果立刻替换草稿，提示条给 12 秒撤销窗口 | 手快、信任重写 |
| 先预览 | 结果只进面板，草稿一个字不动；预览框还能当场改，确认才写回 | 长草稿、重要指令 |

选区优化只在「先预览」下生效：选中一段就只优化那段，确认后只替换选区。

## 安装

> 前提：DSH Web GUI 已能正常使用，profile 目录可写，`pnpm` 在 PATH。

```powershell
# 1) 加进正在运行的那个 profile（把 <profile> 换成 desktop 或 web）
pnpm --dir "$env:USERPROFILE\.dsh\profiles\<profile>" add "github:zhaosiw/dsh-prompt-polish"

# 2) 让 profile 组合它：编辑 <profile>/package.json 的 dsh.profile.bundles，追加 "dsh-prompt-polish"

# 3) 触发一次 profile 重组（宿主 dsh-hmr 监听 patch/manifest，约 2~3 秒）
Add-Content "$env:USERPROFILE\.dsh\profiles\<profile>\cordis.patch.yml" "`n# touch $(Get-Date -Format o)"
```

宿主会**热重组**：不用重启宿主，连页面刷新都不用（新行经 `/plugins/events` SSE 推给已打开的页面）。

仓库里的 `scripts/install.ps1` 把这三步做成幂等脚本（自动探测在跑的 profile、改前备份、失败自动回滚）：

```powershell
pwsh -File .\scripts\install.ps1
pwsh -File .\scripts\uninstall.ps1     # 回滚
node .\scripts\verify.mjs dsh-prompt-polish 61372   # 只读验证：模块图有该行 + bundle 200
```

## 工作原理

两个半区，一个包：

```
lib/index.js        宿主半区：ctx.provide('promptPolish')，把草稿交给 llm 流式改写
lib/typert.host.js  Typert 清单：声明 promptPolish/polish 这条 RPC（codec 用 create() 工厂，零第三方依赖）
lib/client.js       浏览器半区：手写 __ModuleLoader__ 成品 bundle —— 星星 + 提示条 + 菜单 + 预览面板 + Remote 挂载
cordis.patch.yml    组合包补丁：insert 一行 prompt-polish
```

- 浏览器用 `conversation.input.dock`（输入卡片上方整行）挂入口，`order: 40` 排在 Todo/Queue 之后
- 草稿读写走宿主给的 `inputActions`：`captureInsertion()` 拿选区 → `insertText(text, span)` 原子替换；整段替换走 `setDraft(text)`，撤销就是 `setDraft(快照)`
- RPC：客户端把 `createTypertRemoteInfo` 等价的清单 `$mount` 进 `ctx.remote`，之后就是 `ctx.remote.promptPolish.polish({ text, level, locale })`，返回 `{ ok, value } | { ok, error }`
- 模型：跟随 `agent-default-model` 当前选择；`prepareCall` 优先关掉 reasoning，被拒自动退回默认档；输出约定为 `{"text","notes","assumptions"}`
- 预算按档位给：`smooth` 700–900、`structure` 1200–2400、`instruction` 1600–3600 tokens（`min(cap, max(floor, len*2.4+400))`）；撞上 `maxTokens` 自动放大预算重发一次；超时 60 秒
- 浏览器半区是**手写成品**，DSH 不会打包你的 `src/`，所以不需要任何构建工具链

更细的实现调研（带行号证据）在 `docs/`：

| 文档 | 内容 |
| --- | --- |
| [docs/spec.md](docs/spec.md) | 设计与提示词全文（三档规则、保真清单、输出协议、降级表） |
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

`cdp-verify` 会：输入草稿 → 点 ★ → 等提示条 → 打开详情核对版本 → 撤销 → 长按菜单切「先预览」→ 确认插入 → 校验回填 → 试 `Ctrl+Alt+P` → `Esc` 关闭 → 清空收尾，截图存 `test/shots/`（已 gitignore）。`PP_DRAFT='你的草稿' node test/cdp-verify.mjs` 可换草稿复测。

它需要访问本机 GUI：`/` 与 `/api` 带会话 cookie 鉴权，脚本用 `~/.dsh/.credentials.yaml` 里的签名密钥现签一个（`test/mint-cookie.mjs`），只在本机运行、不读取任何模型密钥。

## 已知边界

- 优化用的是当前默认模型；没有可用模型时提示「请先在设置里选择模型」
- 延迟大致随长度走：30 字以内约 2 秒，100 字左右约 4~5 秒（关掉 reasoning 后）
- 直接回填会覆盖草稿，撤销窗口只有 12 秒（提示条消失后就回不去了，请用「先预览」处理重要指令）
- 输入框内换行会被 Lexical 渲染成段落，`innerText` 读起来会多空行，实际段落结构是正确的一行一段
- 按 DSH「模型可见输入应能从会话日志重建」的约定，本插件故意不落 Session；需要留痕时手动复制
- 只在 DSH `0.2.1-rc.2`（Web GUI / desktop profile）上实测；客户端 slot 名与 Remote 形态可能随版本变化

## License

MIT © zhaosiw
