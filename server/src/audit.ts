import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'
import type { RiskLevel } from './riskEngine.js'

export interface AuditEntry {
  id: string
  ts: number
  hostId: string
  hostLabel: string
  command: string
  level: RiskLevel
  executed: boolean // 是否真正放行执行(高危被取消时为 false)
  ruleTitles: string[] // 命中的本地规则标题
  llmSummary?: string
}

const filePath = path.join(config.dataDir, 'audit.json')
const MAX_ENTRIES = 5000 // 超过后丢弃最旧记录,避免文件无限增长

function ensure() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true })
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]', 'utf8')
}

function readAll(): AuditEntry[] {
  ensure()
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return []
  }
}

function writeAll(list: AuditEntry[]) {
  ensure()
  fs.writeFileSync(filePath, JSON.stringify(list), 'utf8')
}

export interface AuditInput {
  hostId: string
  hostLabel: string
  command: string
  level: RiskLevel
  executed: boolean
  ruleTitles: string[]
  llmSummary?: string
}

export function addAuditEntry(input: AuditInput): AuditEntry {
  const list = readAll()
  const entry: AuditEntry = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    hostId: input.hostId,
    hostLabel: input.hostLabel,
    command: input.command.slice(0, 2000),
    level: input.level,
    executed: input.executed,
    ruleTitles: input.ruleTitles.slice(0, 10),
    llmSummary: input.llmSummary?.slice(0, 300),
  }
  list.push(entry)
  if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES)
  writeAll(list)
  return entry
}

export interface AuditQuery {
  level?: RiskLevel
  hostId?: string
  q?: string
  limit?: number
  offset?: number
}

export function listAuditEntries(query: AuditQuery): { total: number; items: AuditEntry[] } {
  let list = readAll()
  if (query.level) list = list.filter((e) => e.level === query.level)
  if (query.hostId) list = list.filter((e) => e.hostId === query.hostId)
  if (query.q) {
    const kw = query.q.toLowerCase()
    list = list.filter((e) => e.command.toLowerCase().includes(kw))
  }
  list = list.sort((a, b) => b.ts - a.ts) // 新的在前
  const total = list.length
  const offset = query.offset ?? 0
  const limit = query.limit ?? 100
  return { total, items: list.slice(offset, offset + limit) }
}

export function clearAuditEntries(): void {
  writeAll([])
}
