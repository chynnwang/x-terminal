import { Client, type SFTPWrapper } from 'ssh2'
import { getCredentials } from './store.js'

interface PoolEntry {
  conn: Client
  timer: NodeJS.Timeout
  sftp?: SFTPWrapper
}

const pool = new Map<string, PoolEntry>()
const IDLE_MS = 5 * 60 * 1000 // 空闲 5 分钟自动断开,避免占用连接

function resetIdleTimer(hostId: string) {
  const e = pool.get(hostId)
  if (!e) return
  clearTimeout(e.timer)
  e.timer = setTimeout(() => {
    try {
      e.conn.end()
    } catch {}
  }, IDLE_MS)
}

// 共享 SSH 连接池:文件传输(SFTP)和资源占用采集(exec)复用同一条连接,减少握手开销
export function getConnection(hostId: string): Promise<Client> {
  const existing = pool.get(hostId)
  if (existing) {
    resetIdleTimer(hostId)
    return Promise.resolve(existing.conn)
  }

  const cred = getCredentials(hostId)
  if (!cred) return Promise.reject(new Error('主机不存在'))

  return new Promise((resolve, reject) => {
    const conn = new Client()
    let settled = false
    conn
      .on('ready', () => {
        const timer = setTimeout(() => {
          try {
            conn.end()
          } catch {}
        }, IDLE_MS)
        pool.set(hostId, { conn, timer })
        const cleanup = () => {
          clearTimeout(timer)
          pool.delete(hostId)
        }
        conn.on('close', cleanup)
        conn.on('error', cleanup)
        if (!settled) {
          settled = true
          resolve(conn)
        }
      })
      .on('error', (err) => {
        if (!settled) {
          settled = true
          reject(err)
        }
      })

    const base = { host: cred.host, port: cred.port, username: cred.username, readyTimeout: 20000 }
    if (cred.authType === 'key') {
      conn.connect({ ...base, privateKey: cred.secret, passphrase: cred.passphrase })
    } else {
      conn.connect({ ...base, password: cred.secret })
    }
  })
}

export function getSftp(hostId: string): Promise<SFTPWrapper> {
  const existing = pool.get(hostId)
  if (existing?.sftp) {
    resetIdleTimer(hostId)
    return Promise.resolve(existing.sftp)
  }
  return getConnection(hostId).then(
    (conn) =>
      new Promise<SFTPWrapper>((resolve, reject) => {
        conn.sftp((err, sftp) => {
          if (err) {
            reject(err)
            return
          }
          const entry = pool.get(hostId)
          if (entry) entry.sftp = sftp
          resolve(sftp)
        })
      }),
  )
}

// 一次性执行远程命令,收集 stdout(用于资源占用采集等轻量查询,不用于交互式会话)
export function execCommand(hostId: string, command: string, timeoutMs = 10000): Promise<string> {
  return getConnection(hostId).then(
    (conn) =>
      new Promise<string>((resolve, reject) => {
        let out = ''
        let settled = false
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true
            reject(new Error('执行超时'))
          }
        }, timeoutMs)
        conn.exec(command, (execErr, stream) => {
          if (execErr) {
            clearTimeout(timer)
            if (!settled) {
              settled = true
              reject(execErr)
            }
            return
          }
          stream.on('data', (d: Buffer) => {
            out += d.toString('utf8')
          })
          stream.stderr.on('data', () => {
            /* 忽略 stderr,只关心标准输出 */
          })
          stream.on('close', () => {
            clearTimeout(timer)
            if (!settled) {
              settled = true
              resolve(out)
            }
          })
          stream.on('error', (e: Error) => {
            clearTimeout(timer)
            if (!settled) {
              settled = true
              reject(e)
            }
          })
        })
      }),
  )
}

function stat(sftp: SFTPWrapper, remotePath: string) {
  return new Promise<import('ssh2').Stats>((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => (err ? reject(err) : resolve(stats)))
  })
}

export function realpath(sftp: SFTPWrapper, remotePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.realpath(remotePath, (err, absPath) => (err ? reject(err) : resolve(absPath)))
  })
}

function readdir(sftp: SFTPWrapper, remotePath: string) {
  return new Promise<import('ssh2').FileEntry[]>((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => (err ? reject(err) : resolve(list)))
  })
}

function mkdirOne(sftp: SFTPWrapper, remotePath: string) {
  return new Promise<void>((resolve, reject) => {
    sftp.mkdir(remotePath, async (err) => {
      if (!err) {
        resolve()
        return
      }
      // 不同 sftp-server 对"目录已存在"返回的错误文案不统一(OpenSSH 只返回通用 Failure),
      // 与其猜测文案,不如直接 stat 确认:已经是目录就当作成功,否则才是真错误
      try {
        const st = await stat(sftp, remotePath)
        if (st.isDirectory()) resolve()
        else reject(err)
      } catch {
        reject(err)
      }
    })
  })
}

function unlink(sftp: SFTPWrapper, remotePath: string) {
  return new Promise<void>((resolve, reject) => {
    sftp.unlink(remotePath, (err) => (err ? reject(err) : resolve()))
  })
}

function rmdirOne(sftp: SFTPWrapper, remotePath: string) {
  return new Promise<void>((resolve, reject) => {
    sftp.rmdir(remotePath, (err) => (err ? reject(err) : resolve()))
  })
}

export function joinRemote(...parts: string[]): string {
  const joined = parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
  return joined.startsWith('/') ? joined : `/${joined}`
}

// 递归创建目录(相当于 mkdir -p)
export async function ensureRemoteDir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const segments = remotePath.split('/').filter(Boolean)
  let cur = ''
  for (const seg of segments) {
    cur += `/${seg}`
    await mkdirOne(sftp, cur)
  }
}

export { stat as statPath, readdir as readDir, unlink as unlinkFile, rmdirOne }

// 递归删除文件/目录
export async function removeRecursive(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const st = await stat(sftp, remotePath)
  if (st.isDirectory()) {
    const entries = await readdir(sftp, remotePath)
    for (const e of entries) {
      await removeRecursive(sftp, joinRemote(remotePath, e.filename))
    }
    await rmdirOne(sftp, remotePath)
  } else {
    await unlink(sftp, remotePath)
  }
}

// SFTP 的 readdir attrs 不带 isDirectory()/isFile() 方法(那是 stat() 返回的 Stats 独有的),
// 这里用 POSIX mode 位掩码自己判断文件类型
const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

export function entryType(mode: number | undefined): 'dir' | 'link' | 'file' {
  if (!mode) return 'file'
  const t = mode & S_IFMT
  if (t === S_IFDIR) return 'dir'
  if (t === S_IFLNK) return 'link'
  return 'file'
}

// 递归遍历目录,把每个文件加进 archiver 实例(用于目录打包下载)
export async function walkAndArchive(
  sftp: SFTPWrapper,
  remotePath: string,
  relBase: string,
  archive: import('archiver').Archiver,
): Promise<void> {
  const entries = await readdir(sftp, remotePath)
  for (const e of entries) {
    const full = joinRemote(remotePath, e.filename)
    const rel = relBase ? `${relBase}/${e.filename}` : e.filename
    const type = entryType(e.attrs.mode)
    if (type === 'dir') {
      await walkAndArchive(sftp, full, rel, archive)
    } else if (type === 'file') {
      archive.append(sftp.createReadStream(full), { name: rel })
    }
  }
}
