import type { Host } from './store.js'

// Xshell 会话文件(.xsh)是 INI 格式。密码字段(Password=)是 Xshell 私有加密,第三方无法解密,
// 因此只兼容非密码字段:主机、端口、协议、用户名、备注(会话名)。

export interface ParsedConnection {
  label: string
  host: string
  port: number
  username: string
}

function parseIni(content: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>()
  let cur = ''
  sections.set(cur, new Map())
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const sec = line.match(/^\[(.+)\]$/)
    if (sec) {
      cur = sec[1]
      if (!sections.has(cur)) sections.set(cur, new Map())
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim()
    sections.get(cur)!.set(key.toLowerCase(), val)
  }
  return sections
}

// 解析单个 .xsh 内容;fallbackName 用作会话名(通常来自文件名去扩展名)。
// 只接受 SSH/SFTP 协议;缺少主机则返回 null。
export function parseXsh(content: string, fallbackName = ''): ParsedConnection | null {
  const ini = parseIni(content)
  const conn = ini.get('CONNECTION') ?? new Map()
  const auth = ini.get('CONNECTION:AUTHENTICATION') ?? new Map()

  const protocol = (conn.get('protocol') || 'SSH').toUpperCase()
  if (protocol !== 'SSH' && protocol !== 'SFTP') return null

  const host = conn.get('host') || ''
  if (!host) return null
  const port = Number(conn.get('port')) || 22
  const username = auth.get('username') || conn.get('username') || ''
  const label = (conn.get('description') || fallbackName || host).trim()

  return { label, host, port, username }
}

// 生成 Xshell 可导入的 .xsh(仅非密码字段)。sessionName 作为会话描述。
export function buildXsh(host: Host): string {
  const lines = [
    '[CONNECTION]',
    'Version=5.2',
    'Protocol=SSH',
    `Host=${host.host}`,
    `Port=${host.port}`,
    `Description=${host.label || ''}`,
    '',
    '[CONNECTION:AUTHENTICATION]',
    'Method=Password',
    `UserName=${host.username}`,
    '',
  ]
  return lines.join('\r\n')
}

// 会话名 → 安全文件名(用于导出的 .xsh 文件名)
export function safeFileName(name: string): string {
  return (name || 'session').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
}
