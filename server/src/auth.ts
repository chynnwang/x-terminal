import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { isNoneMode, verifyPassword } from './security.js'

const tokens = new Set<string>()

function issueToken(): string {
  const token = crypto.randomBytes(32).toString('hex')
  tokens.add(token)
  return token
}

export function login(password: string): string | null {
  // 免密模式:无需密码直接发放 token(此时加密密钥已在启动时解锁)
  if (isNoneMode()) return issueToken()
  // 密码模式:校验密码,成功时 security 会把派生密钥设为当前加密密钥
  if (verifyPassword(password)) return issueToken()
  return null
}

export function verifyToken(token: string | undefined): boolean {
  return Boolean(token && tokens.has(token))
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!verifyToken(token)) {
    res.status(401).json({ error: '未登录或登录已失效' })
    return
  }
  next()
}
