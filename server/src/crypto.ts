import crypto from 'node:crypto'

// 对主机的密码/私钥做 AES-256-GCM 加密。
// 加密密钥由 security.ts 在解锁(登录/免密)时通过 setActiveKey 注入,
// 因此支持"改密码 / 开关密码验证"——切换后用新旧 key 重新加密所有凭据。
let activeKey: Buffer | null = null

// 从口令派生 32 字节密钥(scrypt)。security.ts 用它派生密码模式或设备模式的密钥。
export function deriveKey(secret: string, salt: string): Buffer {
  return crypto.scryptSync(secret, salt, 32)
}

export function setActiveKey(key: Buffer): void {
  activeKey = key
}

export function hasActiveKey(): boolean {
  return activeKey !== null
}

function requireKey(): Buffer {
  if (!activeKey) throw new Error('加密密钥未初始化(尚未解锁)')
  return activeKey
}

// 用指定 key 加解密(迁移密码时对新旧 key 分别调用);不传 key 则用当前 activeKey
export function encryptWith(plain: string, key?: Buffer): string {
  const k = key ?? requireKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptWith(payload: string, key?: Buffer): string {
  const k = key ?? requireKey()
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

export function encrypt(plain: string): string {
  return encryptWith(plain)
}

export function decrypt(payload: string): string {
  return decryptWith(payload)
}
