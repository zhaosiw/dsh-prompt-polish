// 端到端验证：用 headless Chromium + CDP 驱动正在运行的 DSH Web GUI，
// 在 composer 里打字 → 点「优化」→ 等预览 → 截图 → 确认插入 → 校验回填。
// 不依赖 Playwright，只用 Node 自带 WebSocket。
//
// 用法：node test/cdp-verify.mjs [--keep]
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = process.env.CHROME_PATH
  ?? 'C:\\Users\\wgr\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe'
const APP = process.env.DSH_URL ?? 'http://127.0.0.1:61372'
const PORT = Number(process.env.CDP_PORT ?? 9333)
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const profileDir = join(tmpdir(), 'dsh-cdp-' + Date.now())

const log = (...args) => console.log('[cdp]', ...args)

async function httpJson(path, method = 'GET') {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, { method })
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`)
  return response.json()
}

const child = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  '--window-size=1280,900',
  'about:blank',
], { stdio: 'ignore' })

let version
for (let attempt = 0; attempt < 120; attempt += 1) {
  try {
    version = await httpJson('/json/version')
    break
  } catch {
    await sleep(250)
  }
}
if (version === undefined) {
  child.kill()
  throw new Error('Chromium 没有起来（CDP 端口无响应）')
}
log('browser:', version.Browser)

const target = await httpJson(`/json/new?${encodeURIComponent('about:blank')}`, 'PUT')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
const consoleLines = []
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = (message.params.args ?? []).map((arg) => arg.value ?? arg.preview?.description ?? arg.description ?? arg.type).join(' ')
    consoleLines.push(`[${message.params.type}] ${text}`.slice(0, 800))
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    consoleLines.push(`[exception] ${(details.exception?.description ?? details.text ?? '').slice(0, 800)}`)
    return
  }
  const entry = pending.get(message.id)
  if (entry === undefined) return
  pending.delete(message.id)
  if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`))
  else entry.resolve(message.result)
})
function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.exceptionDetails.exception?.description ?? ''))
  return result.result.value
}
async function waitFor(expression, timeoutMs = 30000, label = expression) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(expression)
      if (value) return value
    } catch (error) {
      log('poll error:', String(error).slice(0, 120))
    }
    await sleep(400)
  }
  throw new Error('等待超时：' + label)
}
async function shoot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const file = join(SHOTS, name + '.png')
  writeFileSync(file, Buffer.from(data, 'base64'))
  log('screenshot ->', file)
  return file
}
async function key(code, keyValue, modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: keyValue, windowsVirtualKeyCode: 0, modifiers })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyValue, windowsVirtualKeyCode: 0, modifiers })
}

const report = {}
try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')

  // GUI 需要浏览器会话 cookie：用本机凭证里的签名密钥现签一个。
  const authority = new URL(APP).host
  const credentials = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
  const secret = Buffer.from(/secret:\s*([A-Za-z0-9_-]+)/.exec(credentials)[1], 'base64url')
  const cookieName = 'dsh-auth-' + createHash('sha256').update(authority).digest('base64url')
  const issuedAt = Date.now()
  const body = Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt: issuedAt + 36e5 })).toString('base64url')
  const cookieValue = `v1.${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
  const host = new URL(APP).hostname
  await send('Network.setCookie', { name: cookieName, value: cookieValue, domain: host, path: '/' })
  await send('Page.navigate', { url: APP })
  await sleep(1200)

  const editorExpr = "[...document.querySelectorAll('[contenteditable=\"true\"]')].filter((el) => el.clientHeight > 20).sort((a, b) => b.clientHeight - a.clientHeight)[0]"
  const ready = await waitFor(`(${editorExpr}) !== undefined`, 60000, 'composer 出现')
  log('composer ready:', ready)
  await sleep(1500)

  // 关掉首次启动的说明弹窗（dsh-purge 须知 / 预览版说明 / duet 教程），否则点不到输入框。
  const dismiss = `(() => {
    const labels = ['我已知晓并继续', '继续', '关闭', '不再提醒', '开始教学', '跳过', '我知道了', '好的'];
    let clicked = 0;
    for (const label of labels) {
      for (const el of document.querySelectorAll('button, [role="button"], a, span')) {
        const text = (el.textContent || '').trim();
        if (text === label && el.offsetParent !== null) { el.click(); clicked += 1; break }
      }
    }
    return clicked
  })()`
  for (let round = 0; round < 4; round += 1) {
    const clicked = await evaluate(dismiss)
    if (clicked > 0) log('dismissed overlays:', clicked)
    await sleep(700)
  }
  await shoot('00-cleared')

  // 清空并输入测试草稿
  await evaluate(`(() => { const el = (${editorExpr}); el.focus(); return true })()`)
  await key('KeyA', 'a', 2)
  await key('Backspace', 'Backspace')
  await send('Input.insertText', {
    text: '帮我把这个函数改成异步的 顺便加点日志 不要动别的 返回值别变',
  })
  await sleep(700)
  report.draftBefore = await evaluate(`(${editorExpr}).innerText`)
  if (report.draftBefore.trim() === '') {
    log('insertText 没落地，改用 execCommand 兜底')
    await evaluate(`(() => { const el = (${editorExpr}); el.focus(); document.execCommand('insertText', false, '帮我把这个函数改成异步的 顺便加点日志 不要动别的 返回值别变'); return true })()`)
    await sleep(700)
    report.draftBefore = await evaluate(`(${editorExpr}).innerText`)
  }
  log('draft:', JSON.stringify(report.draftBefore))

  await waitFor("document.querySelector('.pp-trigger') !== null", 15000, '优化按钮出现')
  await shoot('01-trigger')
  await evaluate(`document.querySelector('.pp-trigger').click()`)

  await waitFor("document.querySelector('.pp-panel') !== null", 10000, '面板打开')
  await shoot('02-panel-loading')

  const outcome = await waitFor(
    "(() => { const p = document.querySelector('.pp-preview'); const err = document.querySelector('.pp-error'); if (p) return 'ready'; if (err) return 'error:' + err.innerText; return false })()",
    90000,
    '预览或错误出现',
  )
  log('outcome:', String(outcome).slice(0, 400))
  report.outcome = String(outcome)
  await shoot('03-panel-result')

  if (String(outcome) === 'ready') {
    report.preview = await evaluate(`document.querySelector('.pp-preview').value`)
    report.notes = await evaluate(`Array.from(document.querySelectorAll('.pp-panel .pp-chip')).map(n => n.textContent)`)
    report.levelLabel = await evaluate(`(document.querySelector('.pp-panel .pp-hint') || {}).textContent || ''`)

    // 切到「重度」再看一次（顺带验证档位重跑）
    await evaluate(`(() => { const btn = Array.from(document.querySelectorAll('.pp-level')).find(b => b.textContent === '重度'); if (btn) btn.click(); return true })()`)
    const second = await waitFor(
      "(() => { const p = document.querySelector('.pp-preview'); const skel = document.querySelector('.pp-skel'); if (p && !skel) return 'ready'; if (document.querySelector('.pp-error')) return 'error'; return false })()",
      90000,
      '重度档结果',
    )
    report.heavyOutcome = String(second)
    await shoot('04-panel-heavy')
    report.heavyPreview = await evaluate(`document.querySelector('.pp-preview') ? document.querySelector('.pp-preview').value : ''`)

    await evaluate(`(() => { const btn = Array.from(document.querySelectorAll('.pp-btn')).find(b => b.textContent.includes('确认插入')); if (btn) btn.click(); return true })()`)
    await sleep(900)
    report.draftAfter = await evaluate(`(${editorExpr}).innerText`)
    report.paragraphShape = await evaluate(`(() => { const el = (${editorExpr}); return Array.from(el.children).slice(0, 8).map((node) => node.textContent) })()`)
    report.panelClosed = await evaluate(`document.querySelector('.pp-panel') === null`)
    await shoot('05-inserted')
  }

  // 快捷键：Ctrl+Alt+P 应直接打开面板（编辑器聚焦时）
  await evaluate(`(() => { const el = (${editorExpr}); if (el) el.focus(); document.execCommand('insertText', false, '快捷键测试：把这段改成两句话'); return true })()`)
  await sleep(500)
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyP', key: 'p', windowsVirtualKeyCode: 80, modifiers: 3 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyP', key: 'p', windowsVirtualKeyCode: 80, modifiers: 3 })
  await sleep(800)
  report.shortcutOpened = await evaluate(`document.querySelector('.pp-panel') !== null`)
  await shoot('06-shortcut')
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(400)
  report.escapeClosed = await evaluate(`document.querySelector('.pp-panel') === null`)

  // 收尾：清空草稿，别把测试文本留给用户
  await evaluate(`(() => { const el = (${editorExpr}); if (el) el.focus(); return true })()`)
  await key('KeyA', 'a', 2)
  await key('Backspace', 'Backspace')
  await sleep(300)
  report.cleaned = await evaluate(`(${editorExpr}).innerText.trim() === ''`)
} catch (error) {
  report.error = String(error)
  try {
    await shoot('99-error')
    report.bodyText = await evaluate(`document.body.innerText.slice(0, 1200)`)
  } catch {
    /* ignore */
  }
} finally {
  report.console = consoleLines.filter((line) => /prompt-polish|remote|gateway|typert/i.test(line)).slice(0, 40)
  console.log('\n=== REPORT ===')
  console.log(JSON.stringify(report, null, 2))
  writeFileSync(join(SHOTS, 'report.json'), JSON.stringify(report, null, 2))
  try {
    ws.close()
  } catch {
    /* ignore */
  }
  child.kill()
  await sleep(500)
  if (!process.argv.includes('--keep')) {
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
