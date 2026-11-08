# dsh-prompt-polish

> DSH（DeepSeek Harness）输入框的「二次优化」插件：随手写的一句话 → 按 **轻 / 中 / 重** 三档重写 → **预览确认** → 回填输入框，原意不动。

写完直接发太可惜，重写又怕改味？给它加一档润色：面板里看完再决定要不要用。

![三档示意](https://img.shields.io/badge/levels-3-blue) ![platform](https://img.shields.io/badge/platform-DSH%20Web%20GUI-informational) ![license](https://img.shields.io/badge/license-MIT-green)

## 功能

- **入口**：输入卡片上方的 `Aa 优化` 按钮，或快捷键 `Ctrl/Cmd + Alt + P`
- **三档**：
  | 档位 | 做什么 | 效果 |
  | --- | --- | --- |
  | 轻度 `smooth` | 只修语法、错别字、标点、赘词、指代与衔接 | 结构和信息量都不动，长度 ±15% 内 |
  | 中度 `structure` | 把隐含结构显式化：该分点的分点、该补的范围/输出格式/禁止项补明确 | 信息点一一对应，每句都能在原文找到出处 |
  | 重度 `instruction` | 重组成一条可执行指令：目标 / 范围 / 要求 / 禁止项 / 验收标准 | 模糊表述收敛成可执行描述，缺的参数进「待确认」 |
- **先预览后回填**：结果只进面板，**确认之前草稿一个字都不动**；预览框里还能当场改
- **选区模式**：草稿里选中一段时只优化选区，确认后**只替换选区**（一次可撤销编辑）
- **保真校验**：`@引用`、`/命令`、代码块与行内代码、URL、路径、环境变量、命令参数、标识符、数字都要求逐字保留；客户端再校验一遍，丢了就在面板顶部列出来
- **不写会话**：优化过程不进 Session 历史、不产生对话轮次、不计入上下文
- 档位按浏览器记住（默认「中度」）；提交中/裁决中按钮自动置灰

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
lib/client.js       浏览器半区：手写 __ModuleLoader__ 成品 bundle —— slot 入口 + 预览面板 + 快捷键 + Remote 挂载
cordis.patch.yml    组合包补丁：insert 一行 prompt-polish
```

- 浏览器用 `conversation.input.dock`（输入卡片上方整行）挂入口，`order: 40` 排在 Todo/Queue 之后
- 草稿读写走宿主给的 `inputActions`：`captureInsertion()` 拿选区 → `insertText(text, span)` 原子替换；整段替换走 `setDraft(text)`，替换前比对快照，草稿被改过会先问
- RPC：客户端把 `createTypertRemoteInfo` 等价的清单 `$mount` 进 `ctx.remote`，之后就是 `ctx.remote.promptPolish.polish({ text, level, locale })`，返回 `{ ok, value } | { ok, error }`
- 模型：跟随 `agent-default-model` 当前选择；`prepareCall` 优先关掉 reasoning，被拒自动退回默认档；输出约定为 `{"text","notes","assumptions"}`，`maxTokens = min(8192, max(1600, len*3+800))`，超时 60 秒
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
node test/host-smoke.mjs        # 假 llm 跑 6 个分支：正常/降级/非 JSON 兜底/空输入/无 llm/无模型
node test/probe-manifest.mjs    # 用官方 validateTypertManifest 校验清单
node test/probe-host-load.mjs   # 在真 cordis 里加载宿主半区，断言服务与 typertRemote 标记
node test/cdp-verify.mjs        # headless Chromium + CDP 驱动真实 GUI 跑完整链路
```

`cdp-verify` 会：输入草稿 → 点 `Aa 优化` → 等预览 → 切重度 → 确认插入 → 校验回填 → 试 `Ctrl+Alt+P` → `Esc` 关闭 → 清空收尾，截图存 `test/shots/`（已 gitignore）。

它需要访问本机 GUI：`/` 与 `/api` 带会话 cookie 鉴权，脚本用 `~/.dsh/.credentials.yaml` 里的签名密钥现签一个（`test/mint-cookie.mjs`），只在本机运行、不读取任何模型密钥。

## 已知边界

- 优化用的是当前默认模型；没有可用模型时提示「请先在设置里选择模型」
- 重度档输出更长，已按原文长度放大预算；万一被截断会从 `"text"` 字段抢救正文，不会把裸 JSON 写回输入框
- 输入框内换行会被 Lexical 渲染成段落，`innerText` 读起来会多空行，实际段落结构是正确的一行一段
- 按 DSH「模型可见输入应能从会话日志重建」的约定，本插件故意不落 Session；需要留痕时手动复制预览内容
- 只在 DSH `0.2.1-rc.2`（Web GUI / desktop profile）上实测；客户端 slot 名与 Remote 形态可能随版本变化

## License

MIT © zhaosiw
