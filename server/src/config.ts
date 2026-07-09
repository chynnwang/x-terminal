import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

export const config = {
  port: Number(process.env.PORT || 8899),
  loginPassword: process.env.LOGIN_PASSWORD || 'change-me',
  llm: {
    baseUrl: (process.env.LLM_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || '',
  },
  // 数据目录:默认仓库根 data/(Web/dev 模式);桌面客户端通过 SSH_TERM_DATA_DIR
  // 注入到用户目录(app.getPath('userData')/data),从而与仓库数据隔离、分发时不携带任何数据
  dataDir: process.env.SSH_TERM_DATA_DIR || path.resolve(__dirname, '../../data'),
}

export const llmEnabled = Boolean(config.llm.baseUrl && config.llm.apiKey)
