import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'
import { deriveKey, setActiveKey, hasActiveKey } from './crypto.js'
import { reencryptAllCredentials } from './store.js'

// 安全状态持久化(不存明文密码):
//  - mode='password': 用户设了访问密码,密钥由密码派生;verifier 用于校验密码是否正确
//  - mode='none'    : 免密模式,密钥由随机 deviceSeed 派生(开箱即用,本机任何人可打开)
export type SecurityMode = 'password' | 'none'

interface SecurityFile {
  version: 1
  mode: SecurityMode
  keySalt: string // 派生加密密钥用的 salt(hex)
  verifier?: string // password 模式:sha256(key) 的 hex,校验密码正确性
  deviceSeed?: string // none 模式:随机串,派生设备密钥
}

// 旧版本(未引入 security.json 时)固定的加密 salt,用于兼容已存在的 data/hosts.json
const LEGACY_SALT = 'ssh-web-terminal-salt'

const filePath = () => path.join(config.dataDir, 'security.json')
const hostsPath = () => path.join(config.dataDir, 'hosts.json')

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function readFile(): SecurityFile | null {
  try {
    return JSON.parse(fs.readFileSync(filePath(), 'utf8'))
  } catch {
    return null
  }
}

function writeFile(s: SecurityFile) {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true })
  fs.writeFileSync(filePath(), JSON.stringify(s, null, 2), 'utf8')
}

function hostsFileHasData(): boolean {
  try {
    const arr = JSON.parse(fs.readFileSync(hostsPath(), 'utf8'))
    return Array.isArray(arr) && arr.length > 0
  } catch {
    return false
  }
}

// 服务启动时调用:
//  - 已有 security.json → 保持;若为 none 模式则自动解锁
//  - 无 security.json 但已有旧主机数据 → 建立"兼容旧登录密码"的 password 记录(不自动解锁,等登录)
//  - 无 security.json 且无数据(全新/桌面) → 默认免密(none)开箱即用,用户可稍后在安全设置里加密码
export function initSecurity(): void {
  let s = readFile()
  if (!s && hostsFileHasData()) {
    // 旧数据兼容:沿用固定 salt + 原登录密码,使已加密的 hosts.json 仍可用原密码解密
    const key = deriveKey(config.loginPassword, LEGACY_SALT)
    s = { version: 1, mode: 'password', keySalt: LEGACY_SALT, verifier: sha256Hex(key) }
    writeFile(s)
  }
  if (!s) {
    // 全新安装:不再强制引导设置密码,默认免密进入;需要加密码时去「安全设置」开启即可
    const keySalt = crypto.randomBytes(16).toString('hex')
    const deviceSeed = crypto.randomBytes(32).toString('hex')
    s = { version: 1, mode: 'none', keySalt, deviceSeed }
    writeFile(s)
  }
  if (s && s.mode === 'none' && s.deviceSeed) {
    setActiveKey(deriveKey(s.deviceSeed, s.keySalt))
  }
}

export interface SecurityStatus {
  mode: SecurityMode
  needSetup: boolean // true = 首次运行,尚未设置访问方式
  unlocked: boolean
}

export function getStatus(): SecurityStatus {
  const s = readFile()
  if (!s) return { mode: 'password', needSetup: true, unlocked: false }
  return { mode: s.mode, needSetup: false, unlocked: hasActiveKey() }
}

// 首次运行时设置访问方式(此时通常还没有主机,无需迁移)
export function initSetup(mode: SecurityMode, password?: string): { ok: boolean; error?: string } {
  if (readFile()) return { ok: false, error: '已经初始化过了' }
  const keySalt = crypto.randomBytes(16).toString('hex')
  if (mode === 'password') {
    const pw = String(password ?? '')
    if (pw.length < 4) return { ok: false, error: '密码至少 4 位' }
    const key = deriveKey(pw, keySalt)
    writeFile({ version: 1, mode: 'password', keySalt, verifier: sha256Hex(key) })
    setActiveKey(key)
  } else {
    const deviceSeed = crypto.randomBytes(32).toString('hex')
    const key = deriveKey(deviceSeed, keySalt)
    writeFile({ version: 1, mode: 'none', keySalt, deviceSeed })
    setActiveKey(key)
  }
  return { ok: true }
}

// 校验密码并解锁(password 模式登录时用)。成功则设为当前加密密钥。
export function verifyPassword(password: string): boolean {
  const s = readFile()
  if (!s || s.mode !== 'password' || !s.verifier) return false
  const key = deriveKey(String(password ?? ''), s.keySalt)
  if (sha256Hex(key) !== s.verifier) return false
  setActiveKey(key)
  return true
}

// 免密模式:无需密码即可解锁(供 login 直接放行)
export function isNoneMode(): boolean {
  return readFile()?.mode === 'none'
}

export function needSetup(): boolean {
  return readFile() === null
}

// 改密码:校验旧密码 → 用新密码 key 重新加密所有主机凭据 → 更新记录
export function changePassword(oldPw: string, newPw: string): { ok: boolean; error?: string } {
  const s = readFile()
  if (!s || s.mode !== 'password' || !s.verifier) return { ok: false, error: '当前不是密码模式' }
  const oldKey = deriveKey(String(oldPw ?? ''), s.keySalt)
  if (sha256Hex(oldKey) !== s.verifier) return { ok: false, error: '原密码错误' }
  if (String(newPw ?? '').length < 4) return { ok: false, error: '新密码至少 4 位' }
  const newSalt = crypto.randomBytes(16).toString('hex')
  const newKey = deriveKey(newPw, newSalt)
  reencryptAllCredentials(oldKey, newKey)
  writeFile({ version: 1, mode: 'password', keySalt: newSalt, verifier: sha256Hex(newKey) })
  setActiveKey(newKey)
  return { ok: true }
}

// 关闭密码验证(password → none):校验当前密码 → 迁移到设备密钥
export function disablePassword(curPw: string): { ok: boolean; error?: string } {
  const s = readFile()
  if (!s) return { ok: false, error: '尚未初始化' }
  if (s.mode === 'none') return { ok: true }
  if (!s.verifier) return { ok: false, error: '状态异常' }
  const oldKey = deriveKey(String(curPw ?? ''), s.keySalt)
  if (sha256Hex(oldKey) !== s.verifier) return { ok: false, error: '密码错误' }
  const newSalt = crypto.randomBytes(16).toString('hex')
  const deviceSeed = crypto.randomBytes(32).toString('hex')
  const newKey = deriveKey(deviceSeed, newSalt)
  reencryptAllCredentials(oldKey, newKey)
  writeFile({ version: 1, mode: 'none', keySalt: newSalt, deviceSeed })
  setActiveKey(newKey)
  return { ok: true }
}

// 开启密码验证(none → password):用当前已解锁的设备密钥迁移到新密码密钥
export function enablePassword(newPw: string): { ok: boolean; error?: string } {
  const s = readFile()
  if (!s) return { ok: false, error: '尚未初始化' }
  if (s.mode === 'password') return { ok: false, error: '已经是密码模式' }
  if (!s.deviceSeed) return { ok: false, error: '状态异常' }
  if (String(newPw ?? '').length < 4) return { ok: false, error: '密码至少 4 位' }
  const oldKey = deriveKey(s.deviceSeed, s.keySalt)
  const newSalt = crypto.randomBytes(16).toString('hex')
  const newKey = deriveKey(newPw, newSalt)
  reencryptAllCredentials(oldKey, newKey)
  writeFile({ version: 1, mode: 'password', keySalt: newSalt, verifier: sha256Hex(newKey) })
  setActiveKey(newKey)
  return { ok: true }
}
