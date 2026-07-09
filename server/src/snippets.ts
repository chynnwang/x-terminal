import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'

export interface Snippet {
  id: string
  label: string
  command: string
  createdAt: number
}

const filePath = path.join(config.dataDir, 'snippets.json')

function ensure() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true })
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]', 'utf8')
}

function readAll(): Snippet[] {
  ensure()
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return []
  }
}

function writeAll(list: Snippet[]) {
  ensure()
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8')
}

export function listSnippets(): Snippet[] {
  return readAll().sort((a, b) => a.createdAt - b.createdAt)
}

export interface SnippetInput {
  label: string
  command: string
}

export function createSnippet(input: SnippetInput): Snippet {
  const list = readAll()
  const s: Snippet = {
    id: crypto.randomUUID(),
    label: input.label.trim() || input.command.trim().slice(0, 20),
    command: input.command,
    createdAt: Date.now(),
  }
  list.push(s)
  writeAll(list)
  return s
}

export function updateSnippet(id: string, input: Partial<SnippetInput>): Snippet | null {
  const list = readAll()
  const idx = list.findIndex((s) => s.id === id)
  if (idx < 0) return null
  if (input.label !== undefined) list[idx].label = input.label.trim() || list[idx].label
  if (input.command !== undefined) list[idx].command = input.command
  writeAll(list)
  return list[idx]
}

export function deleteSnippet(id: string): boolean {
  const list = readAll()
  const next = list.filter((s) => s.id !== id)
  if (next.length === list.length) return false
  writeAll(next)
  return true
}
