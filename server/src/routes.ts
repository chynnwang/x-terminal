import { Router } from 'express'
import archiver from 'archiver'
import busboy from 'busboy'
import { login, requireAuth } from './auth.js'
import { listHosts, createHost, updateHost, deleteHost, clearHostsGroup, getHost, DEVICE_TYPES, type HostInput, type DeviceType } from './store.js'
import { parseXsh, buildXsh, safeFileName } from './xshell.js'
import { buildBackup, parseBackup } from './backupFormat.js'
import { analyzeLocal, type RiskLevel } from './riskEngine.js'
import { analyzeWithLlm, nl2cmd } from './llm.js'
import { explainLocal, getCommandHint } from './localExplain.js'
import { getCurrentModel, getLlmConfig, isLlmEnabled, updateSettings } from './settings.js'
import { addAuditEntry, listAuditEntries, type AuditInput } from './audit.js'
import { listGroups, createGroup, updateGroup, deleteGroup, groupExists } from './groups.js'
import { listSnippets, createSnippet, updateSnippet, deleteSnippet, type SnippetInput } from './snippets.js'
import { getHostStats } from './hostStats.js'
import { getStatus, initSetup, changePassword, disablePassword, enablePassword, type SecurityMode } from './security.js'

export const router = Router()

// ---- 访问安全:密码模式 / 免密模式 / 改密码 / 开关密码验证 ----
// 状态查询无需登录:前端据此决定显示登录页 / 首次设置页 / 直接进入
router.get('/security', (_req, res) => {
  res.json(getStatus())
})

// 首次运行:设置访问密码或选择免密
router.post('/security/init', (req, res) => {
  const mode: SecurityMode = req.body?.mode === 'none' ? 'none' : 'password'
  const r = initSetup(mode, req.body?.password ? String(req.body.password) : undefined)
  if (!r.ok) {
    res.status(400).json({ error: r.error })
    return
  }
  res.json({ ok: true })
})

router.put('/security/password', requireAuth, (req, res) => {
  const r = changePassword(String(req.body?.oldPassword ?? ''), String(req.body?.newPassword ?? ''))
  if (!r.ok) {
    res.status(400).json({ error: r.error })
    return
  }
  res.json({ ok: true })
})

// 开关密码验证:enable=false 关闭(需当前密码),enable=true 开启(需新密码)
router.put('/security/mode', requireAuth, (req, res) => {
  const enable = Boolean(req.body?.enable)
  const r = enable
    ? enablePassword(String(req.body?.newPassword ?? ''))
    : disablePassword(String(req.body?.password ?? ''))
  if (!r.ok) {
    res.status(400).json({ error: r.error })
    return
  }
  res.json({ ok: true })
})

const rank: Record<RiskLevel, number> = { safe: 0, caution: 1, danger: 2 }
function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return rank[a] >= rank[b] ? a : b
}

router.post('/login', (req, res) => {
  const { password } = req.body ?? {}
  const token = login(String(password ?? ''))
  if (!token) {
    res.status(401).json({ error: '密码错误' })
    return
  }
  res.json({ token })
})

router.get('/config', requireAuth, (_req, res) => {
  res.json({ llmEnabled: isLlmEnabled(), model: getCurrentModel() })
})

// ---- 命令分析模型设置(含大模型网关地址与 Key) ----
function buildSettingsResponse() {
  const { baseUrl, apiKey, model, isCustomGateway } = getLlmConfig()
  return {
    model,
    llmEnabled: isLlmEnabled(),
    llmBaseUrl: baseUrl,
    llmApiKey: apiKey,
    isCustomGateway,
  }
}

router.get('/settings', requireAuth, (_req, res) => {
  res.json(buildSettingsResponse())
})

router.put('/settings', requireAuth, (req, res) => {
  const body = req.body ?? {}
  updateSettings({
    model: body.model !== undefined ? String(body.model).trim() : undefined,
    llmBaseUrl: body.llmBaseUrl !== undefined ? String(body.llmBaseUrl).trim().replace(/\/+$/, '') : undefined,
    llmApiKey: body.llmApiKey !== undefined ? String(body.llmApiKey).trim() : undefined,
  })
  res.json(buildSettingsResponse())
})

// 用输入框里"还没保存"的网关地址/Key 测试连接并拉模型列表,方便用户先验证再保存
router.post('/gateway/test', requireAuth, async (req, res) => {
  const baseUrl = String(req.body?.llmBaseUrl ?? '').trim().replace(/\/+$/, '')
  const apiKey = String(req.body?.llmApiKey ?? '').trim()
  if (!baseUrl || !apiKey) {
    res.status(400).json({ error: '网关地址和 Key 不能为空', models: [] })
    return
  }
  try {
    const resp = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!resp.ok) throw new Error(`网关返回 ${resp.status}`)
    const data: any = await resp.json()
    const models = Array.from(new Set((data?.data ?? []).map((m: any) => String(m.id)))).sort() as string[]
    res.json({ models })
  } catch (e: any) {
    res.status(502).json({ error: e?.message || '连接失败', models: [] })
  }
})

// 代理网关的模型列表(用当前已保存的网关配置),供前端下拉选择
router.get('/models', requireAuth, async (_req, res) => {
  if (!isLlmEnabled()) {
    res.json({ models: [] })
    return
  }
  const { baseUrl, apiKey } = getLlmConfig()
  try {
    const resp = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!resp.ok) throw new Error(`网关返回 ${resp.status}`)
    const data: any = await resp.json()
    const models = Array.from(new Set((data?.data ?? []).map((m: any) => String(m.id)))).sort() as string[]
    res.json({ models })
  } catch (e: any) {
    res.status(502).json({ error: e?.message || '获取模型列表失败', models: [] })
  }
})

router.get('/hosts', requireAuth, (_req, res) => {
  res.json(listHosts())
})

// ---- 主机分组 ----
router.get('/groups', requireAuth, (_req, res) => {
  res.json(listGroups())
})

router.post('/groups', requireAuth, (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name) {
    res.status(400).json({ error: '分组名不能为空' })
    return
  }
  res.json(createGroup(name))
})

router.put('/groups/:id', requireAuth, (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name) {
    res.status(400).json({ error: '分组名不能为空' })
    return
  }
  const updated = updateGroup(req.params.id, name)
  if (!updated) {
    res.status(404).json({ error: '分组不存在' })
    return
  }
  res.json(updated)
})

router.delete('/groups/:id', requireAuth, (req, res) => {
  const ok = deleteGroup(req.params.id)
  if (!ok) {
    res.status(404).json({ error: '分组不存在' })
    return
  }
  clearHostsGroup(req.params.id) // 该分组下主机变为未分组
  res.json({ ok: true })
})

// ---- 快捷命令:保存常用命令为按钮,点一下就发到当前终端 ----
router.get('/snippets', requireAuth, (_req, res) => {
  res.json(listSnippets())
})

router.post('/snippets', requireAuth, (req, res) => {
  const label = String(req.body?.label ?? '').trim()
  const command = String(req.body?.command ?? '')
  if (!command) {
    res.status(400).json({ error: '命令不能为空' })
    return
  }
  res.json(createSnippet({ label, command }))
})

router.put('/snippets/:id', requireAuth, (req, res) => {
  const patch: Partial<SnippetInput> = {
    label: req.body?.label !== undefined ? String(req.body.label) : undefined,
    command: req.body?.command !== undefined ? String(req.body.command) : undefined,
  }
  const updated = updateSnippet(req.params.id, patch)
  if (!updated) {
    res.status(404).json({ error: '快捷命令不存在' })
    return
  }
  res.json(updated)
})

router.delete('/snippets/:id', requireAuth, (req, res) => {
  const ok = deleteSnippet(req.params.id)
  if (!ok) {
    res.status(404).json({ error: '快捷命令不存在' })
    return
  }
  res.json({ ok: true })
})

function parseDeviceType(v: any): DeviceType | undefined {
  return typeof v === 'string' && (DEVICE_TYPES as string[]).includes(v) ? (v as DeviceType) : undefined
}

function parseHostInput(body: any): HostInput {
  return {
    label: String(body.label ?? '').trim(),
    host: String(body.host ?? '').trim(),
    port: Number(body.port) || 22,
    username: String(body.username ?? '').trim(),
    authType: body.authType === 'key' ? 'key' : 'password',
    groupId: body.groupId && groupExists(String(body.groupId)) ? String(body.groupId) : null,
    deviceType: parseDeviceType(body.deviceType) ?? 'server',
    secret: String(body.secret ?? ''),
    passphrase: body.passphrase ? String(body.passphrase) : undefined,
  }
}

router.post('/hosts', requireAuth, (req, res) => {
  const input = parseHostInput(req.body ?? {})
  if (!input.host || !input.username) {
    res.status(400).json({ error: '主机地址和用户名必填' })
    return
  }
  res.json(createHost(input))
})

router.put('/hosts/:id', requireAuth, (req, res) => {
  const body = req.body ?? {}
  const patch: Partial<HostInput> = {
    label: body.label !== undefined ? String(body.label) : undefined,
    host: body.host !== undefined ? String(body.host) : undefined,
    port: body.port !== undefined ? Number(body.port) || 22 : undefined,
    username: body.username !== undefined ? String(body.username) : undefined,
    authType: body.authType !== undefined ? (body.authType === 'key' ? 'key' : 'password') : undefined,
    groupId:
      body.groupId !== undefined ? (body.groupId && groupExists(String(body.groupId)) ? String(body.groupId) : null) : undefined,
    deviceType: parseDeviceType(body.deviceType),
    secret: body.secret !== undefined ? String(body.secret) : undefined,
    passphrase: body.passphrase !== undefined ? String(body.passphrase) : undefined,
  }
  const updated = updateHost(req.params.id, patch)
  if (!updated) {
    res.status(404).json({ error: '主机不存在' })
    return
  }
  res.json(updated)
})

router.delete('/hosts/:id', requireAuth, (req, res) => {
  const ok = deleteHost(req.params.id)
  if (!ok) {
    res.status(404).json({ error: '主机不存在' })
    return
  }
  res.json({ ok: true })
})

// 服务器类主机的实时资源占用(CPU/内存/磁盘),网络设备类主机不适用,前端不会调用
router.get('/hosts/:id/stats', requireAuth, async (req, res) => {
  const host = getHost(req.params.id)
  if (!host) {
    res.status(404).json({ error: '主机不存在' })
    return
  }
  const stats = await getHostStats(req.params.id)
  res.json(stats)
})

// ---- 连接导入/导出(兼容 Xshell,仅非密码字段) ----
// 导出:选中主机(ids 逗号分隔,不传则全部)。
// format=json 导出本工具的 JSON 备份(单文件,含分组);默认 format=xsh 兼容 Xshell(单台 .xsh,多台打包 .zip)。
router.get('/connections/export', requireAuth, async (req, res) => {
  const idsParam = typeof req.query.ids === 'string' ? req.query.ids : ''
  const ids = idsParam ? idsParam.split(',').map((s) => s.trim()).filter(Boolean) : []
  const format = req.query.format === 'json' ? 'json' : 'xsh'
  let hosts = listHosts()
  if (ids.length) hosts = hosts.filter((h) => ids.includes(h.id))
  if (!hosts.length) {
    res.status(404).json({ error: '没有可导出的主机' })
    return
  }

  if (format === 'json') {
    const content = buildBackup(hosts, listGroups())
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="connections-backup.json"`)
    res.send(content)
    return
  }

  if (hosts.length === 1) {
    const h = hosts[0]
    const name = safeFileName(h.label || h.host)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}.xsh"`)
    res.send(buildXsh(h))
    return
  }

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="connections.zip"`)
  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.on('error', (err) => res.destroy(err))
  archive.pipe(res)
  const used = new Set<string>()
  for (const h of hosts) {
    let name = safeFileName(h.label || h.host)
    // 避免同名会话覆盖
    let file = `${name}.xsh`
    let n = 2
    while (used.has(file)) file = `${name}_${n++}.xsh`
    used.add(file)
    archive.append(buildXsh(h), { name: file })
  }
  await archive.finalize()
})

// 导入:multipart/form-data,可上传多个文件。支持 Xshell .xsh(仅非密码字段,不含分组)
// 和本工具的 .json 备份(含分组,自动按名称匹配/新建分组)。密码留空待补填。
router.post('/connections/import', requireAuth, (req, res) => {
  const parsed: { content: string; name: string; filename: string }[] = []
  const bb = busboy({ headers: req.headers, limits: { files: 50, fileSize: 5 * 1024 * 1024 } })

  bb.on('file', (_name, stream, info) => {
    const chunks: Buffer[] = []
    const filename = info.filename || ''
    const base = filename.replace(/\.[^.]+$/, '')
    stream.on('data', (c: Buffer) => chunks.push(c))
    stream.on('end', () => parsed.push({ content: Buffer.concat(chunks).toString('utf8'), name: base, filename }))
    stream.on('error', () => {})
  })

  bb.on('close', () => {
    let imported = 0
    let groupsCreated = 0
    const skipped: string[] = []
    const groupIdByName = new Map(listGroups().map((g) => [g.name, g.id]))

    function resolveGroupId(name: string | null): string | null {
      if (!name) return null
      const existing = groupIdByName.get(name)
      if (existing) return existing
      const g = createGroup(name)
      groupIdByName.set(name, g.id)
      groupsCreated++
      return g.id
    }

    for (const f of parsed) {
      if (f.filename.toLowerCase().endsWith('.json')) {
        const backup = parseBackup(f.content)
        if (!backup) {
          skipped.push(f.name || '(未命名)')
          continue
        }
        for (const h of backup.hosts) {
          createHost({
            label: h.label,
            host: h.host,
            port: h.port,
            username: h.username,
            authType: h.authType,
            groupId: resolveGroupId(h.group),
            deviceType: h.deviceType,
            secret: h.secret || '',
            passphrase: h.passphrase,
          })
          imported++
        }
        continue
      }

      const conn = parseXsh(f.content, f.name)
      if (!conn) {
        skipped.push(f.name || '(未命名)')
        continue
      }
      createHost({
        label: conn.label,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        authType: 'password',
        groupId: null,
        deviceType: 'server',
        secret: '',
      })
      imported++
    }
    res.json({ imported, skipped, groupsCreated })
  })

  bb.on('error', (e: any) => {
    res.status(500).json({ error: e?.message || '导入失败' })
  })

  req.pipe(bb)
})

// 命令分析:本地规则 + 可选大模型
router.post('/analyze', requireAuth, async (req, res) => {
  const command = String(req.body?.command ?? '')
  const useLlm = req.body?.useLlm !== false && isLlmEnabled()
  const local = analyzeLocal(command)
  const explain = explainLocal(command) // 本地命令知识库解读,不依赖网络,始终生成
  const hint = getCommandHint(command) // 当前命令的参数速查表(供输入框旁边实时提示),同样不依赖网络

  let llm = null
  let llmError: string | null = null
  if (useLlm && command.trim()) {
    try {
      llm = await analyzeWithLlm(command)
    } catch (e: any) {
      llmError = e?.message || '大模型分析失败'
    }
  }

  const level: RiskLevel = llm ? maxLevel(local.level, llm.risk) : local.level
  res.json({ command, level, local, explain, hint, llm, llmError, llmEnabled: isLlmEnabled() })
})

// ---- 超级终端:自然语言 -> shell 命令(必须依赖大模型,本地知识库无法反向生成命令) ----
router.post('/nl2cmd', requireAuth, async (req, res) => {
  const instruction = String(req.body?.instruction ?? '').trim()
  if (!instruction) {
    res.status(400).json({ error: '请输入你想做的事情' })
    return
  }
  if (!isLlmEnabled()) {
    res.status(400).json({ error: '该功能需要先在设置里配置大模型网关' })
    return
  }
  try {
    const result = await nl2cmd(instruction)
    if (!result.command) {
      res.status(502).json({ error: '大模型没有返回可用的命令,换个说法再试试' })
      return
    }
    const risk = analyzeLocal(result.command)
    res.json({ ...result, risk })
  } catch (e: any) {
    res.status(502).json({ error: e?.message || '生成命令失败' })
  }
})

// ---- 审计日志:记录输入过的命令,可按风险等级/主机/关键词筛选 ----
router.post('/audit', requireAuth, (req, res) => {
  const body = req.body ?? {}
  const level: RiskLevel = ['safe', 'caution', 'danger'].includes(body.level) ? body.level : 'safe'
  const input: AuditInput = {
    hostId: String(body.hostId ?? ''),
    hostLabel: String(body.hostLabel ?? ''),
    command: String(body.command ?? ''),
    level,
    executed: Boolean(body.executed),
    ruleTitles: Array.isArray(body.ruleTitles) ? body.ruleTitles.map(String) : [],
    llmSummary: body.llmSummary ? String(body.llmSummary) : undefined,
  }
  if (!input.command.trim()) {
    res.status(400).json({ error: '命令不能为空' })
    return
  }
  res.json(addAuditEntry(input))
})

router.get('/audit', requireAuth, (req, res) => {
  const { level, hostId, q, limit, offset } = req.query
  const result = listAuditEntries({
    level: typeof level === 'string' && ['safe', 'caution', 'danger'].includes(level) ? (level as RiskLevel) : undefined,
    hostId: typeof hostId === 'string' && hostId ? hostId : undefined,
    q: typeof q === 'string' && q ? q : undefined,
    limit: limit ? Math.min(Number(limit) || 100, 500) : 100,
    offset: offset ? Number(offset) || 0 : 0,
  })
  res.json(result)
})
