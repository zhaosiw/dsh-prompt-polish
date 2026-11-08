# DSH 插件部署可行性验证（task-3）

> 结论先行：**新插件在运行中的宿主里可以热加载，不需要重启 DSH；也不需要刷新浏览器页面**（页面通过 `/plugins/events` SSE 跟随模块图）。
> 但有两个必须知道的前提：**(1) 当前 GUI 跑的是 `desktop` profile，不是 `web` profile**；**(2) 手动 `pnpm add` 本身不会触发重组，必须再有一次 profile patch/manifest 变更（或插件管理器操作）把它带进树。**

验证时间：2026-11-08 14:33–14:50（Asia/Shanghai）。全程未重启宿主进程。

---

## 0. 环境事实（先纠正一个前提错误）

| 事实 | 证据 |
|---|---|
| 当前 GUI `http://127.0.0.1:61372` 由 **desktop profile** 的宿主进程提供 | 进程 PID 19548：`DeepSeek Harness.exe --expose-internals "D:\app\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\index.js" "D:\app\DeepSeek Harness\resources\app.asar\dsh" ~\.dsh\profiles\desktop …` |
| 61372 / 61373 / 61374 全部属于该进程 | `Get-NetTCPConnection -State Listen` → OwningProcess 19548 |
| `dsh-desktop-host` 以 `profile: "desktop"` 启动 Web 应用并监听 `--port 0` | `dsh-desktop-host/lib/index.js` L218-245（`runProfile({ profile: "desktop", args: ["--no-open","--host","127.0.0.1","--port","0"] })`） |
| `~\.dsh\profiles\web` 存在但**当前没有进程在用** | 只有一个 node/desktop 宿主进程；`profiles\web` 是 `dsh web` CLI 的 profile |
| 宿主 release | `{"version":"0.2.1-rc.2","commit":"332895e"}`（`/plugins/events` graph 帧） |

**因此：装进 `profiles\web` 对当前这个 GUI 完全无效。** 生产安装必须写 `profiles\desktop`（或用 `dsh plugin --profile desktop …`），或者用户改用 `dsh web` 起一个 web profile 的宿主。

安全边界确认：`/plugins/*` 路由**不需要鉴权**（`/plugins/events` 直接 200 `text/event-stream`），而 `/` 与 `/api` 需要 `dsh-auth-*` Cookie（见 §7）。所以可以用纯 HTTP 只读地观察「宿主此刻把哪些客户端模块发给浏览器」。

---

## 1. loader 树怎么组成，裸插件怎么进树

### 分层顺序（低 → 高优先级）

```
profile/cordis.yml            → 空数组（根）
  ← 每个 dsh.profile.bundles 的 dsh.bundle.patch（按 bundles 有序列表逐层应用）
  ← profile/cordis.patch.yml   （用户 patch 层）
  ← home 的 ~/.dsh/cordis.patch.yml（更高优先级）
  ← --patch 启动重叠层
```

证据：`dsh-app-boot/README.zh.md:50`（profile 由可安装组合包 + 自身 `cordis.patch.yml` 组成，组合包的 `dsh.bundle.patch` 指定 patch）；`:61`（`cordis.patch.yml` 是应用在所有组合包层之后的 tweak 层：替换条目 config、插入新条目、`!!js` 插值）；`profiles\desktop\cordis.yml` 实际内容只有注释 + `[]`。

### 裸插件（非 bundle）的 insert 写法

```yaml
- insert:
    - id: prompt-polish          # 稳定 id，patch 定位/开关都靠它
      name: dsh-prompt-polish    # ★ 必须是 npm 包名，且与 package.json 的 name 完全一致
      # config: { ... }          # 可选，传给插件 apply(ctx, config)
      # inject: [ systemPrompt ] # 可选，条目级服务注入
```

字段表：`cordis-plugin-loader/README.md:27-34`（`id` / `name` / `config` / `group` / `disabled` / `inject`）。

- `name` 也可以写绝对路径或 `file:` URL（`dsh-app-boot/README.zh.md:65`：insert 条目可以是绝对文件系统路径、文件 URL 或包标识符；patch 加载会把相对 `./`、`../` 转成文件 URL）。
- **但客户端半区只认「specifier 恰好等于包名」的那一行**（`dsh-client-modules/README.zh.md:131`：「`dsh-client-modules` 只把一个包的浏览器半侧挂在说明符恰为包名的那一行 Loader 行上」）。所以要按钮/slot 出现在 UI，`name` 必须是包名，不要写路径。
- 幂等：同一 id 重复 insert 不是「合并」，是再加一行；`disabled` 覆盖只更新最后一条匹配项（`dsh-plugin-manager/README.zh.md:40`）。

### 客户端半区声明（包自己的 package.json）

```jsonc
"exports": { "./client": { "default": "./lib/client.js" } },
"dsh": {
  "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-api-remotes"] }
}
```
扫描实现：`dsh-client-modules/lib/index.js:720-750` —— 读 entry 名解析到 package.json，要求 `dsh.client.platform === "web"`（`:733`），否则该行不产生浏览器模块；声明了 `dsh.client` 但 `exports` 里没有 `./client` 会直接抛错（`:738`）。`inject` / `external` / `immediately` 见 `:40-71`。

---

## 2. 客户端半区：宿主直接 serve 成品，不做运行时打包（结论：确定）

**宿主直接 serve 包里已构建的 `lib/client.js`，运行时不用 esbuild 从 `src/` 打包。**

证据链：
1. `dsh-client-modules/README.zh.md:55`：「宿主提供的是已构建的客户端 bundle，因此启动前 `pnpm run build` 必须已产出每个 `lib/client.js`；缺失 bundle 会明确导致激活失败」。
2. `dsh-client-modules/lib/index.js:828-839`：`initialBundleSnapshot()` 直接 `readFileSync(clientPath)`，`ENOENT` 时抛 `MissingClientBundleError`（消息 `client bundle not found; run \`pnpm run build\` before launch`）。**该检查发生在「组合/扫描」阶段，不是启动期**——名字里的 "before launch" 是给源码开发者的提示，对已运行的宿主它表现为该行组合失败。
3. 实测：我们把**手写的** 23 KB `lib/client.js`（`window.__ModuleLoader__.load({ id, factory })` 形态）放进包，宿主直接以 `text/javascript` 200 提供（见 §5），没有任何构建步骤。
4. 成品 bundle 的形态：`window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => { … return module.exports } })`，末尾 `exports.apply = apply; exports.inject = inject;`（对照 `dsh-experimental-client-ui-voice-input/lib/client.js` 首尾）。`require()` 只解析平台 seed 表 + `dsh.client.external` 声明的外部模块（`dsh-client-modules/README.zh.md:51`、`:73`）。

→ 我们的手写 bundle 路线成立，**不需要 tsdown/tsc 构建**；只要 `id` 与包名一致、`exports.apply/inject` 存在。

---

## 3. 热重组机制：有没有 watch，粒度是什么

**有 watch，粒度是「整 profile 重新组合 + 单 entry 级启停」。**

- `dsh-hmr`：启动器给了 `profileContext` 时 base 组合包以 `root: []` 启用 HMR（`dsh-hmr/README.zh.md:27`）；它「在初始化时注册 profile manifest 和两份用户 patch 的监听」（`:61`），文件变化经 `runExclusive()` 串行化后交给 `reconcileProfile()` → `app-boot` 的 `recomposeProfile()`（`:59`、`:63`）。
- 粒度：**不是重建整棵树**。重组会重新读一遍组合包层与 patch 层（`dsh-plugin-manager/README.zh.md:98`：「每次配置刷新重新读取组合包选择与 patch 层，更新原有根 Include」），然后只重启/新增变化的行，未变化的 entry 不会重复导入（`dsh-hmr/README.zh.md:69`：「由该调用启动它们…且不会重复导入同一条目」）。
- manifest（package.json）监听**只对有序 `dsh.profile.bundles` 变化**触发重载（`dsh-hmr/README.zh.md:59`：「HMR 不获取包操作写锁；manifest 通知仅在有序 `dsh.profile.bundles` 列表变化时触发重载」）；`:118` 进一步说明「HMR 自身监听触发的 profile 重新组合不会因仅涉及依赖的 manifest 变化而执行，因此在 Plugin Manager 之外执行的安装在下一次重新组合或重启时生效」。
- 文件监听细节：精确路径监听 + `awaitWriteFinish: true`（默认 2 秒写入稳定窗口）；**Plugin Manager 直接发起的操作不等文件事件**（`dsh-hmr/README.zh.md:47`）。
- 官方描述的行为：`dsh-plugin-manager/README.zh.md:14`「在 YAML 中启用 HMR 时，配置变化立即生效」；`dsh-client-ui-plugin-manager/README.zh.md:65`「启用了 HMR 的 profile 在操作完成前重组」；`:69`「启用了 HMR 的 profile 的树随即重组…页面无需重载即跟随客户端模块图」。

**由此得出的操作顺序（关键坑）**：先 `pnpm add`（只改 dependencies → 不触发），再写 patch（触发重组 → 新 entry 被装载）。反过来先写 patch 会因为包还解析不到而报模块找不到。

---

## 4. 客户端模块图何时重扫：刷新页面够不够？

**够，而且连刷新都不需要。**

- Node 半侧逐包**增量扫描** Loader 条目，每次 `internal/plugin` 事件把该 fiber 的 entry 名标脏，微任务 flush 对账（`dsh-client-modules/README.zh.md:77`「增量组合」）；`index.js:558`：激活时 `for (const entry of ctx.loader.entries()) this.dirty.add(entry.options.name)`。
- 图变化通过 `dsh-client-hmr` 的 `/plugins/events` SSE 推给**已打开的页面**：「Host 半侧…提供 `/plugins/events`。它转发现有的图变化与重建通知；每个新连接都会收到当前完整图」（`dsh-client-hmr/README.zh.md:62`）；「普通插件的启停无需刷新页面或重启 Host 即可生效」（`:12`）。
- 浏览器侧对新 row 用**单资源 URL**加载，不会重放启动 batch（`dsh-client-modules/README.zh.md:89`）。

→ 结论：**刷新页面 = 足够；但实际执行到位的路径连刷新都不需要**。真正必须重启的只有 false 情形：没有 HMR 的 profile、包目录被移动（`restartReason: 'package-moved'`）、或被逐出的模块无法重新导入（`dsh-plugin-manager/README.zh.md:100`）。

---

## 5. 实证记录（本轮真实执行过，已回滚文件）

> 说明：本节实验在「不要写 profile」的纠偏消息**之前**完成；收到纠偏后已把三个 profile 文件还原到实验前状态（见 §5.4）。

### 5.1 安装（desktop profile，pnpm 11.12.0）

```powershell
pnpm --version                                              # 11.12.0
pnpm --dir ~\.dsh\profiles\desktop add "file:<repo>/plugin"
# + dsh-prompt-polish file:E:/工作台/.../plugin
# Packages: +2   Done in 15.1s
```

- profile `package.json` 出现 `"dsh-prompt-polish": "file:E:/工作台/.../plugin"`。
- `profiles\desktop\node_modules\dsh-prompt-polish` 是**普通目录（真实拷贝），不是符号链接也不是硬链接**：`Get-Item` → `Attributes=Directory`、`LinkType`/`LinkTarget` 空；`fsutil reparsepoint query` → `Error 4390: not a reparse point`；`fsutil hardlink list lib/client.js` 只列出自身。里面 `lib/client.js`、`lib/index.js`、`lib/typert.host.js` 齐全。
  - 推论：**Node 解析不要求符号链接**，profile 的 `node_modules` 里放一份普通目录副本即可被 `name: <包名>` 解析到。
  - 代价：改插件源码不会自动进 `node_modules`（副本不是链接），要么重跑 `pnpm add`/`pnpm install`，要么改用 `link:` 依赖或目录 junction 做开发期联调。
- 该步之后模块图**没有**变化（符合 §3 的「仅依赖变化不重载」）。

### 5.2 写 patch 层 → 秒级热重组（核心证据）

在 `profiles\desktop\cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: prompt-polish
      name: dsh-prompt-polish
```

随后（**未重启宿主、未刷新页面**）用 `node` 直连 `/plugins/events` 抓图帧：

```
基线: {"rev":"fca963ca1925", "release":{"version":"0.2.1-rc.2","commit":"332895e"}, entries:…}
之后: {"rev":"32498c4defbe", entries: 79,
       polish:[{"id":"dsh-prompt-polish",
                "url":"plugins/??dsh-prompt-polish/client.js&rev=45dd83ee2014",
                "rev":"45dd83ee2014",
                "inject":["@deepseek-ai/dsh-api-remotes"]}]}
```

→ 新插件**已经进入宿主发给浏览器的模块图**，rev 从 `fca963ca1925` 变为 `32498c4defbe`，entry 数 79。这一行本身就是「宿主半区已装载 + 客户端半区已登记」的直接证据。

### 5.3 bundle 路由

| 请求 | 结果 |
|---|---|
| `GET /plugins/??dsh-prompt-polish/client.js&rev=45dd83ee2014`（combo 形态，即图里给的 URL） | **200** `text/javascript; charset=utf-8`，len **22429**，含 `data-prompt-polish`，首行 `// dsh-prompt-polish — 浏览器半区（client plugin bundle）。` |
| `GET /plugins/dsh-prompt-polish/client.js`（**不带 rev**） | 404 |
| `GET /plugins/dsh-prompt-polish/client.js?rev=45dd83ee2014` | 404（单资源 URL 的正确形态是 `/plugins/<pkg>/client.<name>.js?rev=`；`client.js` 这个入口在 combo 里才是 `??<pkg>/client.js`） |

→ 宿主**已经在对外提供我们手写的 bundle**，浏览器拿到就能执行。

### 5.4 回滚与一个坑

已还原（`*.bak-polish-20261108-144400`）：
`profiles\desktop\{package.json, cordis.patch.yml, pnpm-lock.yaml}`、`profiles\web\{package.json, cordis.patch.yml, pnpm-lock.yaml}`。

**坑**：还原后文件里已无 `prompt-polish`，但模块图**仍显示该行**（rev 仍 `32498c4defbe`）——因为 `Copy-Item` 把 `.bak` 的**旧 mtime 一起复制回去**，chokidar 的写入稳定/变化检测没把它当成变更，于是没有触发重组。当前宿主树里留下了一条「孤儿行」（文件已无声明，运行中还有该行）。

修复方式（任选其一，都不需要重启）：
```powershell
# 1) 轻推一下 patch 文件的 mtime，让它被 watcher 看见
(Get-Item ~\.dsh\profiles\desktop\cordis.patch.yml).LastWriteTime = Get-Date
# 2) 或直接把声明加回去（推荐的正式安装状态）
# 3) 或等下一次任何 patch/manifest/Plugin Manager 变更时自然对账
```
注意：孤儿行存在时，如果再对同一 id `insert`，会出现重复行（不是合并）。所以正式安装前先确认图里是否已有 `dsh-prompt-polish`。

### 5.5 第二次观测：bundle 内容变化会自己热替换（`rebuilt` 链路）

14:52 复测（脚本 `notes/_verify.mjs`）：

```
GRAPH_REV 936a305430f9      entries 79
GRAPH_ROW {"id":"dsh-prompt-polish","url":"plugins/??dsh-prompt-polish/client.js&rev=406374eb868c",
           "rev":"406374eb868c","inject":["@deepseek-ai/dsh-api-remotes"]}
BUNDLE_STATUS 200   BUNDLE_LEN 23439   BUNDLE_MARKER true
```

对比 §5.2 的 `rev 45dd83ee2014 / len 22429`：包文件被改动后，**行 rev 变成 `406374eb868c`、bundle 长度跟着变、图 rev 变成 `936a305430f9`**，全程没有任何宿主重启。这正是 `dsh-client-hmr` 的 `rebuilt` 帧链路（revision 由入口的 `mtimeMs`/`ctimeMs`/大小派生，见 `dsh-client-modules/README.zh.md:79`）：**改一版代码 = 浏览器里自动换一版插件，只需重跑 `pnpm add`（副本不是链接）或换 `link:` 依赖**。

补充：`_verify.mjs` 退出时 Node 在 Windows 上偶发打印 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`（SSE 流未读完导致的收尾噪声），**不影响前面的输出**；`install.ps1` 因此按输出里的 `GRAPH_HIT` / `BUNDLE_STATUS` 断言，而不是看退出码。

---

## 6. 正式安装命令序列（幂等，见 install.ps1）

```powershell
# 0) 确认哪个 profile 在跑（不要盲目用 web）
#    有 desktop 宿主进程时就是它
# 1) 备份
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item ~\.dsh\profiles\desktop\package.json        "...\package.json.bak-$ts"
Copy-Item ~\.dsh\profiles\desktop\cordis.patch.yml   "...\cordis.patch.yml.bak-$ts"
Copy-Item ~\.dsh\profiles\desktop\pnpm-lock.yaml     "...\pnpm-lock.yaml.bak-$ts"
# 2) 装依赖（file: 本地包，hoisted 会拷成普通目录）
pnpm --dir ~\.dsh\profiles\desktop add "file:<repo>/plugin"
# 3) 写 patch 层（裸插件 insert；name 必须等于包名）
#    → 保存瞬间触发 HMR 重组
# 4) 验证（无需重启、无需刷新）
node <本目录>\_verify.mjs     # 打印图里是否含 dsh-prompt-polish + bundle 路由状态码
# 5) UI 验证：composer 上方出现 [data-prompt-polish] 容器
```

回滚：
```powershell
pnpm --dir ~\.dsh\profiles\desktop remove dsh-prompt-polish
Copy-Item ~\.dsh\profiles\desktop\cordis.patch.yml.bak-<ts> ~\.dsh\profiles\desktop\cordis.patch.yml
(Get-Item ~\.dsh\profiles\desktop\cordis.patch.yml).LastWriteTime = Get-Date   # 关键：别让 mtime 回退
```

---

## 7. 已知风险 / 坑清单

1. **profile 认错**：`profiles\web` 现在没有宿主；写它等于白做。以进程命令行为准。
2. **`/` 与 `/api` 需要鉴权**：`dsh-auth-<base64url(sha256("127.0.0.1:PORT"))>` Cookie，签名密钥来自 `~/.dsh/.credentials.yaml` 的 `client-connection/browser-session.secret`。本轮用该 secret **无法**伪造 Cookie（宿主内存中的 secret 与磁盘记录不一致，401）。`/plugins/*` 不鉴权，足以做模块图/bundle 验证。
3. **只 `pnpm add` 不会生效**：必须再有一次 patch 写入或 Plugin Manager 操作（§3、§5.1）。
4. **mtime 回退会被漏检**：用 `Copy-Item` 还原后 touch 一下（§5.4）。
5. **包名即客户端身份**：patch 里 `name` 写路径、或 `id` 与包名不一致时，宿主半区能起，但浏览器半区不会挂（`dsh-client-modules/README.zh.md:131`）。
6. **`dsh.client.inject` 要写全**：我们的 client 用了 `slots`（`conversation.composer.dock`）与 `api-remotes`；漏写在浏览器侧是运行期注入失败，而不是宿主报错。
7. **slot 名要先确认存在**：bundle 里注册的是 `conversation.composer.dock`（`lib/client.js:475`）。若该 slot 不存在，`ctx.slots.inject` 不会派发，`[data-prompt-polish]` 也就不出现——**UI 不出现 ≠ 插件没加载**，先看图帧与 bundle 200。
8. 卸载/替换包时，`pnpm remove` 后若图里仍有孤儿行，同样要 touch patch 让它对账。

---

## 8. 未证实项

- **页面里 `[data-prompt-polish]` 的实际渲染**：本轮只做到「图里有行 + bundle 200 且内容正确」这一层；因为 `/` 需要 Cookie 且无法伪造，没有做成浏览器截图。
- `conversation.composer.dock` 这个 slot 是否真实存在（属 task-1 的 slot 调研范围）。
- 若 `pnpm add` 期间宿主正好读到半写入的 node_modules 会怎样（本轮未发生；Plugin Manager 官方路径会串行化写入，手动路径没有这个保护）。

---

## 9. 参考（file:line 证据索引）

- `dsh-app-boot/README.zh.md:50,54,61,63,65,94`
- `dsh-hmr/README.zh.md:27,47,59,61,63,69,118`
- `dsh-client-hmr/README.zh.md:12,62,89`
- `dsh-client-modules/README.zh.md:12,34,38,42,51,55,73,77,89,131`
- `dsh-client-modules/lib/index.js:720-750`（resolveMeta/locatePkgJson）、`:733`、`:738`、`:828-839`（MissingClientBundleError）、`:558`（dirty entries）
- `dsh-plugin-manager/README.zh.md:14,40,44,48,52,100`
- `dsh-client-ui-plugin-manager/README.zh.md:65,69`
- `cordis-plugin-loader/README.md:27-34`（entry 字段）
- `dsh-desktop-host/lib/index.js:218-245`（profile/端口引导）
- `dsh-client-connection/lib/index.js:271-560`（BrowserAuth / Cookie 规则）
