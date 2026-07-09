import { Router } from 'express'
import path from 'node:path'
import archiver from 'archiver'
import busboy from 'busboy'
import { requireAuth } from './auth.js'
import {
  getSftp,
  joinRemote,
  ensureRemoteDir,
  removeRecursive,
  walkAndArchive,
  statPath,
  readDir,
  entryType,
  realpath,
} from './sftp.js'

export const sftpRouter = Router()

sftpRouter.use(requireAuth)

function q(req: any, name: string, fallback = ''): string {
  const v = req.query[name]
  return typeof v === 'string' ? v : fallback
}

sftpRouter.get('/:hostId/list', async (req, res) => {
  const remotePath = q(req, 'path', '.')
  try {
    const sftp = await getSftp(req.params.hostId)
    const resolved = await realpath(sftp, remotePath)
    const list = await readDir(sftp, resolved)
    const entries = list
      .map((e) => ({
        name: e.filename,
        type: entryType(e.attrs.mode),
        size: e.attrs.size ?? 0,
        mtime: (e.attrs.mtime ?? 0) * 1000,
      }))
      .sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name))
    res.json({ path: resolved, entries })
  } catch (e: any) {
    res.status(500).json({ error: e?.message || '读取目录失败' })
  }
})

sftpRouter.post('/:hostId/mkdir', async (req, res) => {
  const remotePath = String(req.body?.path ?? '')
  if (!remotePath) {
    res.status(400).json({ error: '路径不能为空' })
    return
  }
  try {
    const sftp = await getSftp(req.params.hostId)
    await ensureRemoteDir(sftp, remotePath)
    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e?.message || '创建目录失败' })
  }
})

sftpRouter.post('/:hostId/rename', async (req, res) => {
  const from = String(req.body?.from ?? '')
  const to = String(req.body?.to ?? '')
  if (!from || !to) {
    res.status(400).json({ error: '路径不能为空' })
    return
  }
  try {
    const sftp = await getSftp(req.params.hostId)
    await new Promise<void>((resolve, reject) => {
      sftp.rename(from, to, (err) => (err ? reject(err) : resolve()))
    })
    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e?.message || '重命名失败' })
  }
})

sftpRouter.delete('/:hostId/remove', async (req, res) => {
  const remotePath = q(req, 'path')
  if (!remotePath) {
    res.status(400).json({ error: '路径不能为空' })
    return
  }
  try {
    const sftp = await getSftp(req.params.hostId)
    await removeRecursive(sftp, remotePath)
    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e?.message || '删除失败' })
  }
})

sftpRouter.get('/:hostId/download', async (req, res) => {
  const remotePath = q(req, 'path')
  if (!remotePath) {
    res.status(400).json({ error: '路径不能为空' })
    return
  }
  try {
    const sftp = await getSftp(req.params.hostId)
    const st = await statPath(sftp, remotePath)
    const base = path.posix.basename(remotePath) || 'download'

    if (st.isDirectory()) {
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(base)}.zip"`)
      const archive = archiver('zip', { zlib: { level: 6 } })
      archive.on('error', (err) => res.destroy(err))
      archive.pipe(res)
      await walkAndArchive(sftp, remotePath, '', archive)
      await archive.finalize()
    } else {
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(base)}"`)
      const rs = sftp.createReadStream(remotePath)
      rs.on('error', (err: Error) => res.destroy(err))
      rs.pipe(res)
    }
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ error: e?.message || '下载失败' })
    else res.destroy()
  }
})

// 上传:multipart/form-data,字段 relPath(相对目标目录的路径)+ file(内容)
// 直接流式写入远端 SFTP,不落本地磁盘
sftpRouter.post('/:hostId/upload', (req, res) => {
  const targetDir = q(req, 'path', '.')
  const hostId = req.params.hostId

  let relPath = ''
  let handled = false
  let fileTask: Promise<void> | null = null

  const bb = busboy({ headers: req.headers, limits: { files: 1 } })

  bb.on('field', (name, value) => {
    if (name === 'relPath') relPath = value
  })

  bb.on('file', (_name, stream, info) => {
    handled = true
    const rel = (relPath || info.filename || 'file').replace(/^\/+/, '')
    const remotePath = joinRemote(targetDir, rel)
    const parentDir = path.posix.dirname(remotePath)

    fileTask = (async () => {
      const sftp = await getSftp(hostId)
      if (parentDir && parentDir !== '.') await ensureRemoteDir(sftp, parentDir)
      await new Promise<void>((resolve, reject) => {
        const ws = sftp.createWriteStream(remotePath)
        let done = false
        const finish = (err?: Error) => {
          if (done) return
          done = true
          err ? reject(err) : resolve()
        }
        ws.on('close', () => finish())
        ws.on('error', finish)
        stream.on('error', finish)
        stream.pipe(ws)
      })
    })()
  })

  bb.on('close', async () => {
    if (!handled) {
      res.status(400).json({ error: '未收到文件' })
      return
    }
    try {
      await fileTask
      res.json({ ok: true })
    } catch (e: any) {
      res.status(500).json({ error: e?.message || '上传失败' })
    }
  })

  bb.on('error', (e: any) => {
    res.status(500).json({ error: e?.message || '上传失败' })
  })

  req.pipe(bb)
})
