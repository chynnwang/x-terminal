import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { createServer, type Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { config } from './config.js'
import { router } from './routes.js'
import { sftpRouter } from './sftpRoutes.js'
import { handleSshConnection } from './sshSession.js'
import { getLlmConfig, isLlmEnabled } from './settings.js'
import { initSecurity } from './security.js'

export interface StartOptions {
  // 传 0 表示由系统分配空闲端口(桌面客户端用,避免端口冲突);不传则用 config.port
  port?: number
  // 前端静态资源目录(桌面客户端传 web/dist 的绝对路径);由 server 托管以保证同源 /api 与 /ws。
  // 不传则回退到 SSH_TERM_WEB_DIR 环境变量;都没有则不托管静态资源(dev 由 vite 负责)。
  webDir?: string
}

// 可编程启动:桌面客户端(Electron 主进程)直接 import 调用;Web/CLI 模式走文件末尾的直跑入口
export function startServer(opts: StartOptions = {}): Promise<{ port: number; server: Server }> {
  initSecurity() // 初始化安全状态(旧数据兼容 / 免密模式自动解锁)

  const app = express()
  app.use(express.json({ limit: '2mb' }))
  app.use('/api/sftp', sftpRouter)
  app.use('/api', router)

  // 生产/桌面模式:托管前端静态资源 + SPA 回退,让前端与 API/WS 同源
  const webDir = opts.webDir ?? process.env.SSH_TERM_WEB_DIR
  if (webDir && fs.existsSync(webDir)) {
    app.use(express.static(webDir))
    app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
      res.sendFile(path.join(webDir, 'index.html'))
    })
  }

  const server = createServer(app)

  // SSH 终端走 WebSocket:/ws/ssh
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/ws/ssh')) {
      wss.handleUpgrade(req, socket, head, (ws) => handleSshConnection(ws))
    } else {
      socket.destroy()
    }
  })

  const port = opts.port ?? config.port
  return new Promise((resolve) => {
    server.listen(port, () => {
      const actual = (server.address() as { port: number }).port
      console.log(`[server] http://localhost:${actual}`)
      const llm = getLlmConfig()
      console.log(`[server] 大模型网关: ${isLlmEnabled() ? `已启用 (${llm.model}${llm.isCustomGateway ? ', 自定义网关' : ''})` : '未配置'}`)
      resolve({ port: actual, server })
    })
  })
}

// CLI/Web 直跑入口:node dist/index.js 或 tsx watch src/index.ts 时自动启动。
// 桌面客户端(Electron)会在 import 前设 SSH_TERM_EMBEDDED=1,以便自己控制端口/时机,不走这里。
if (!process.env.SSH_TERM_EMBEDDED) {
  startServer()
}
