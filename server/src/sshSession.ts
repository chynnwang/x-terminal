import { Client } from 'ssh2'
import type { WebSocket } from 'ws'
import { getCredentials } from './store.js'
import { verifyToken } from './auth.js'

// 前端 -> 后端 消息
type ClientMsg =
  | { type: 'auth'; token: string; hostId: string; cols?: number; rows?: number }
  | { type: 'data'; data: string }
  | { type: 'resize'; cols: number; rows: number }

// 后端 -> 前端 消息
function send(ws: WebSocket, msg: object) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

export function handleSshConnection(ws: WebSocket) {
  let conn: Client | null = null
  let stream: any = null
  let authed = false

  ws.on('message', (raw) => {
    let msg: ClientMsg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (msg.type === 'auth') {
      if (authed) return
      if (!verifyToken(msg.token)) {
        send(ws, { type: 'error', message: '未登录或登录已失效' })
        ws.close()
        return
      }
      const cred = getCredentials(msg.hostId)
      if (!cred) {
        send(ws, { type: 'error', message: '主机不存在' })
        ws.close()
        return
      }
      authed = true
      startSsh(msg.cols ?? 80, msg.rows ?? 24, cred)
      return
    }

    if (!authed) return

    if (msg.type === 'data' && stream) {
      stream.write(msg.data)
    } else if (msg.type === 'resize' && stream) {
      stream.setWindow(msg.rows, msg.cols, 0, 0)
    }
  })

  ws.on('close', () => {
    try {
      stream?.end()
    } catch {}
    try {
      conn?.end()
    } catch {}
  })

  function startSsh(cols: number, rows: number, cred: NonNullable<ReturnType<typeof getCredentials>>) {
    conn = new Client()
    conn
      .on('ready', () => {
        send(ws, { type: 'status', message: `已连接 ${cred.username}@${cred.host}` })
        conn!.shell({ term: 'xterm-256color', cols, rows }, (err, s) => {
          if (err) {
            send(ws, { type: 'error', message: `打开 shell 失败: ${err.message}` })
            ws.close()
            return
          }
          stream = s
          s.on('data', (d: Buffer) => send(ws, { type: 'data', data: d.toString('utf8') }))
          s.stderr?.on('data', (d: Buffer) => send(ws, { type: 'data', data: d.toString('utf8') }))
          s.on('close', () => {
            send(ws, { type: 'status', message: '\r\n[会话已结束]' })
            ws.close()
          })
        })
      })
      .on('error', (err) => {
        send(ws, { type: 'error', message: `连接失败: ${err.message}` })
        ws.close()
      })
      .on('close', () => {
        ws.close()
      })

    const base = { host: cred.host, port: cred.port, username: cred.username, readyTimeout: 20000 }
    if (cred.authType === 'key') {
      conn.connect({ ...base, privateKey: cred.secret, passphrase: cred.passphrase })
    } else {
      conn.connect({ ...base, password: cred.secret })
    }
  }
}
