import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'

export interface Group {
  id: string
  name: string
  createdAt: number
}

const filePath = path.join(config.dataDir, 'groups.json')

function ensure() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true })
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]', 'utf8')
}

function readAll(): Group[] {
  ensure()
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return []
  }
}

function writeAll(list: Group[]) {
  ensure()
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8')
}

export function listGroups(): Group[] {
  return readAll().sort((a, b) => a.createdAt - b.createdAt)
}

export function createGroup(name: string): Group {
  const list = readAll()
  const g: Group = { id: crypto.randomUUID(), name, createdAt: Date.now() }
  list.push(g)
  writeAll(list)
  return g
}

export function updateGroup(id: string, name: string): Group | null {
  const list = readAll()
  const idx = list.findIndex((g) => g.id === id)
  if (idx < 0) return null
  list[idx] = { ...list[idx], name }
  writeAll(list)
  return list[idx]
}

export function deleteGroup(id: string): boolean {
  const list = readAll()
  const next = list.filter((g) => g.id !== id)
  if (next.length === list.length) return false
  writeAll(next)
  return true
}

export function groupExists(id: string): boolean {
  return readAll().some((g) => g.id === id)
}
