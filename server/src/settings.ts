import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

interface Settings {
  model?: string
  llmBaseUrl?: string
  llmApiKey?: string
}

const filePath = path.join(config.dataDir, 'settings.json')

function ensure() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true })
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '{}', 'utf8')
}

function readSettings(): Settings {
  ensure()
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(s: Settings) {
  ensure()
  fs.writeFileSync(filePath, JSON.stringify(s, null, 2), 'utf8')
}

export function getSettings(): Settings {
  return readSettings()
}

// 空字符串视为"清除该项自定义值",落盘时去掉该字段(退回 .env 默认值)
export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...readSettings() }
  if (patch.model !== undefined) {
    if (patch.model) next.model = patch.model
    else delete next.model
  }
  if (patch.llmBaseUrl !== undefined) {
    if (patch.llmBaseUrl) next.llmBaseUrl = patch.llmBaseUrl
    else delete next.llmBaseUrl
  }
  if (patch.llmApiKey !== undefined) {
    if (patch.llmApiKey) next.llmApiKey = patch.llmApiKey
    else delete next.llmApiKey
  }
  writeSettings(next)
  return next
}

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  isCustomGateway: boolean
}

// 命令分析实际使用的网关配置:用户在设置里填过就用自定义值,否则用 .env 里的默认值
export function getLlmConfig(): LlmConfig {
  const s = readSettings()
  const baseUrl = (s.llmBaseUrl || config.llm.baseUrl).replace(/\/+$/, '')
  const apiKey = s.llmApiKey || config.llm.apiKey
  const model = s.model || config.llm.model
  return { baseUrl, apiKey, model, isCustomGateway: Boolean(s.llmBaseUrl || s.llmApiKey) }
}

export function isLlmEnabled(): boolean {
  const { baseUrl, apiKey } = getLlmConfig()
  return Boolean(baseUrl && apiKey)
}

export function getCurrentModel(): string {
  return getLlmConfig().model
}
