import type { Host, DeviceType, AuthType } from './store.js'
import type { Group } from './groups.js'

// 本工具自有的连接备份格式(JSON),相比 Xshell 的 .xsh 额外携带分组信息。
// 导出(buildBackup)不含密码/私钥,导入后需手动补填;但导入(parseBackup)兼容
// 携带明文 secret/passphrase 的外部来源文件(如用户自行整理的备份),若提供则一并导入。

export interface BackupHost {
  label: string
  host: string
  port: number
  username: string
  authType: AuthType
  deviceType: DeviceType
  group: string | null
  secret?: string
  passphrase?: string
}

export interface BackupFile {
  version: 1
  exportedAt: string
  groups: string[]
  hosts: BackupHost[]
}

export function buildBackup(hosts: Host[], groups: Group[]): string {
  const nameById = new Map(groups.map((g) => [g.id, g.name]))
  const file: BackupFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    groups: groups.map((g) => g.name),
    hosts: hosts.map((h) => ({
      label: h.label,
      host: h.host,
      port: h.port,
      username: h.username,
      authType: h.authType,
      deviceType: h.deviceType,
      group: h.groupId ? nameById.get(h.groupId) ?? null : null,
    })),
  }
  return JSON.stringify(file, null, 2)
}

const AUTH_TYPES: AuthType[] = ['password', 'key']
const DEVICE_TYPES: DeviceType[] = ['server', 'huawei', 'h3c', 'fortinet', 'routeros', 'aruba', 'other']

function isBackupHost(v: any): v is BackupHost {
  return (
    v &&
    typeof v === 'object' &&
    typeof v.host === 'string' &&
    v.host.length > 0 &&
    typeof v.port === 'number' &&
    typeof v.username === 'string' &&
    (v.group === null || typeof v.group === 'string')
  )
}

// 解析本工具的 JSON 备份;结构不符合预期时返回 null(视为无法识别,由调用方计入 skipped)。
export function parseBackup(content: string): BackupFile | null {
  let raw: any
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (!raw || raw.version !== 1 || !Array.isArray(raw.groups) || !Array.isArray(raw.hosts)) return null
  if (!raw.groups.every((g: any) => typeof g === 'string')) return null
  if (!raw.hosts.every(isBackupHost)) return null

  const hosts: BackupHost[] = raw.hosts.map((h: any) => ({
    label: typeof h.label === 'string' && h.label ? h.label : h.host,
    host: h.host,
    port: h.port || 22,
    username: h.username || '',
    authType: AUTH_TYPES.includes(h.authType) ? h.authType : 'password',
    deviceType: DEVICE_TYPES.includes(h.deviceType) ? h.deviceType : 'server',
    group: h.group ?? null,
    secret: typeof h.secret === 'string' ? h.secret : '',
    passphrase: typeof h.passphrase === 'string' && h.passphrase ? h.passphrase : undefined,
  }))

  return { version: 1, exportedAt: raw.exportedAt || '', groups: raw.groups, hosts }
}
