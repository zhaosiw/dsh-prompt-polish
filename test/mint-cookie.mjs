// 给本机运行的 DSH Web GUI 生成一个有效的浏览器会话 cookie（用于 headless 验证）。
// 仅本机、只读用途：secret 来自 ~/.dsh/.credentials.yaml 的 client-connection/browser-session 记录。
import { createHmac, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOST = process.env.DSH_HOST ?? '127.0.0.1:61372'
const credentialsPath = process.env.DSH_CREDENTIALS ?? join(homedir(), '.dsh', '.credentials.yaml')

const yaml = readFileSync(credentialsPath, 'utf8')
const match = /secret:\s*([A-Za-z0-9_-]+)/.exec(yaml)
if (match === null) {
  console.error('没有在凭证文件里找到 browser-session secret')
  process.exit(1)
}
const secret = Buffer.from(match[1], 'base64url')

const authority = HOST
const name = 'dsh-auth-' + createHash('sha256').update(authority).digest('base64url')
const issuedAt = Date.now()
const expiresAt = issuedAt + 6 * 60 * 60 * 1000
const body = Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }), 'utf8').toString('base64url')
const signature = createHmac('sha256', secret).update(body).digest('base64url')
const value = `v1.${body}.${signature}`

console.log(JSON.stringify({ name, value, authority, issuedAt, expiresAt }))
