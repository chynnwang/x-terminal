import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'
import { encrypt, decrypt, encryptWith, decryptWith } from './crypto.js'

export type AuthType = 'password' | 'key'

export type DeviceType = 'server' | 'huawei' | 'h3c' | 'fortinet' | 'routeros' | 'aruba' | 'other'
export const DEVICE_TYPES: DeviceType[] = ['server', 'huawei', 'h3c', 'fortinet', 'routeros', 'aruba', 'other']

export interface Host {
  id: string
  label: string
  host: string
  port: number
  username: string
  authType: AuthType
  groupId: string | null
  deviceType: DeviceType
  createdAt: number
}

// 存盘结构:公开字段 + 加密后的敏感字段
interface StoredHost extends Host {
  secretEnc: string // 密码 或 私钥(按 authType)
  passphraseEnc?: string // 私钥口令(可选)
}

const filePath = path.join(config.dataDir, 'hosts.json')

function ensure() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true })
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]', 'utf8')
}

function readAll(): StoredHost[] {
  ensure()
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return []
  }
}

function writeAll(list: StoredHost[]) {
  ensure()
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8')
}

function toPublic(h: StoredHost): Host {
  const { secretEnc, passphraseEnc, ...pub } = h
  return pub
}

export function listHosts(): Host[] {
  return readAll().map(toPublic)
}

export function getHost(id: string): Host | null {
  const h = readAll().find((x) => x.id === id)
  return h ? toPublic(h) : null
}

export interface HostInput {
  label: string
  host: string
  port: number
  username: string
  authType: AuthType
  groupId?: string | null
  deviceType?: DeviceType
  secret: string
  passphrase?: string
}

export function createHost(input: HostInput): Host {
  const list = readAll()
  const h: StoredHost = {
    id: crypto.randomUUID(),
    label: input.label,
    host: input.host,
    port: input.port,
    username: input.username,
    authType: input.authType,
    groupId: input.groupId ?? null,
    deviceType: input.deviceType ?? 'server',
    createdAt: Date.now(),
    secretEnc: encrypt(input.secret),
    passphraseEnc: input.passphrase ? encrypt(input.passphrase) : undefined,
  }
  list.push(h)
  writeAll(list)
  return toPublic(h)
}

export function updateHost(id: string, input: Partial<HostInput>): Host | null {
  const list = readAll()
  const idx = list.findIndex((h) => h.id === id)
  if (idx < 0) return null
  const cur = list[idx]
  const next: StoredHost = {
    ...cur,
    label: input.label ?? cur.label,
    host: input.host ?? cur.host,
    port: input.port ?? cur.port,
    username: input.username ?? cur.username,
    authType: input.authType ?? cur.authType,
    groupId: input.groupId !== undefined ? input.groupId : cur.groupId,
    deviceType: input.deviceType ?? cur.deviceType ?? 'server',
    // 仅当传入非空 secret 时才更新(编辑时留空表示不改)
    secretEnc: input.secret ? encrypt(input.secret) : cur.secretEnc,
    passphraseEnc:
      input.passphrase !== undefined
        ? input.passphrase
          ? encrypt(input.passphrase)
          : undefined
        : cur.passphraseEnc,
  }
  list[idx] = next
  writeAll(list)
  return toPublic(next)
}

export function deleteHost(id: string): boolean {
  const list = readAll()
  const next = list.filter((h) => h.id !== id)
  if (next.length === list.length) return false
  writeAll(next)
  return true
}

// 改密码 / 开关密码验证时:用旧 key 解密所有主机凭据,再用新 key 重新加密。
// 先在内存里全部转换成功后再一次性写回;任一条解密失败会抛错且不写盘,避免半加密状态。
export function reencryptAllCredentials(oldKey: Buffer, newKey: Buffer): void {
  const list = readAll()
  for (const h of list) {
    h.secretEnc = encryptWith(decryptWith(h.secretEnc, oldKey), newKey)
    if (h.passphraseEnc) h.passphraseEnc = encryptWith(decryptWith(h.passphraseEnc, oldKey), newKey)
  }
  writeAll(list)
}

// 分组被删除时,该分组下的主机变为未分组,而不是被删除
export function clearHostsGroup(groupId: string): void {
  const list = readAll()
  let changed = false
  for (const h of list) {
    if (h.groupId === groupId) {
      h.groupId = null
      changed = true
    }
  }
  if (changed) writeAll(list)
}

export interface HostCredentials {
  host: string
  port: number
  username: string
  authType: AuthType
  secret: string
  passphrase?: string
}

export function getCredentials(id: string): HostCredentials | null {
  const h = readAll().find((x) => x.id === id)
  if (!h) return null
  return {
    host: h.host,
    port: h.port,
    username: h.username,
    authType: h.authType,
    secret: decrypt(h.secretEnc),
    passphrase: h.passphraseEnc ? decrypt(h.passphraseEnc) : undefined,
  }
}
