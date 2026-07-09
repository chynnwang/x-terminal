export type DeviceType = 'server' | 'huawei' | 'h3c' | 'fortinet' | 'routeros' | 'aruba' | 'other'

export interface Host {
  id: string
  label: string
  host: string
  port: number
  username: string
  authType: 'password' | 'key'
  groupId: string | null
  deviceType: DeviceType
  createdAt: number
}

export interface HostForm {
  label: string
  host: string
  port: number
  username: string
  authType: 'password' | 'key'
  groupId?: string | null
  deviceType?: DeviceType
  secret: string
  passphrase?: string
}

export interface Group {
  id: string
  name: string
  createdAt: number
}

export type RiskLevel = 'safe' | 'caution' | 'danger'

export interface LlmAnalysis {
  summary: string
  detail: string
  risk: RiskLevel
  riskReason: string
  suggestion: string
  model: string
}

export interface CommandHint {
  base: string
  flags: { flag: string; desc: string }[]
  subcommands?: { name: string; desc: string }[]
}

export interface AnalyzeResult {
  command: string
  level: RiskLevel
  local: { level: RiskLevel; matched: { title: string; reason: string }[] }
  explain: { summary: string; detail: string; suggestion?: string } | null
  hint: CommandHint | null
  llm: LlmAnalysis | null
  llmError: string | null
  llmEnabled: boolean
}

export interface Settings {
  model: string
  llmEnabled: boolean
  llmBaseUrl: string
  llmApiKey: string
  isCustomGateway: boolean
}

export interface SettingsPatch {
  model?: string
  llmBaseUrl?: string
  llmApiKey?: string
}

export interface AuditEntry {
  id: string
  ts: number
  hostId: string
  hostLabel: string
  command: string
  level: RiskLevel
  executed: boolean
  ruleTitles: string[]
  llmSummary?: string
}

export interface AuditLogInput {
  hostId: string
  hostLabel: string
  command: string
  level: RiskLevel
  executed: boolean
  ruleTitles: string[]
  llmSummary?: string
}

export interface AuditQuery {
  level?: RiskLevel | 'all'
  hostId?: string
  q?: string
  limit?: number
  offset?: number
}

export interface SftpEntry {
  name: string
  type: 'file' | 'dir' | 'link'
  size: number
  mtime: number
}

export interface NlCommandResult {
  command: string
  explanation: string
  model: string
  risk: { level: RiskLevel; matched: { title: string; reason: string }[] }
}

export interface HostStats {
  cpuPercent: number | null
  memPercent: number | null
  diskPercent: number | null
  error?: string
}

export interface Snippet {
  id: string
  label: string
  command: string
  createdAt: number
}

export type SecurityMode = 'password' | 'none'

export interface SecurityStatus {
  mode: SecurityMode
  needSetup: boolean
  unlocked: boolean
}

export interface ImportResult {
  imported: number
  skipped: string[]
}

const TOKEN_KEY = 'ssh_web_token'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t)
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const resp = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  })
  if (resp.status === 401) {
    clearToken()
    throw new Error('登录已失效,请重新登录')
  }
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error((data as any).error || `请求失败 (${resp.status})`)
  return data as T
}

export const api = {
  async login(password: string) {
    const resp = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error((data as any).error || '登录失败')
    return data as { token: string }
  },
  // ---- 访问安全 ----
  securityStatus: () => req<SecurityStatus>('/security'),
  securityInit: (mode: SecurityMode, password?: string) =>
    req<{ ok: true }>('/security/init', { method: 'POST', body: JSON.stringify({ mode, password }) }),
  changePassword: (oldPassword: string, newPassword: string) =>
    req<{ ok: true }>('/security/password', { method: 'PUT', body: JSON.stringify({ oldPassword, newPassword }) }),
  // enable=false 关闭密码验证(需当前密码);enable=true 开启(需新密码)
  setSecurityMode: (enable: boolean, opts: { password?: string; newPassword?: string }) =>
    req<{ ok: true }>('/security/mode', { method: 'PUT', body: JSON.stringify({ enable, ...opts }) }),

  config: () => req<{ llmEnabled: boolean; model: string }>('/config'),
  listHosts: () => req<Host[]>('/hosts'),
  createHost: (f: HostForm) => req<Host>('/hosts', { method: 'POST', body: JSON.stringify(f) }),
  updateHost: (id: string, f: Partial<HostForm>) =>
    req<Host>(`/hosts/${id}`, { method: 'PUT', body: JSON.stringify(f) }),
  deleteHost: (id: string) => req<{ ok: true }>(`/hosts/${id}`, { method: 'DELETE' }),
  hostStats: (id: string) => req<HostStats>(`/hosts/${id}/stats`),
  analyze: (command: string, useLlm: boolean) =>
    req<AnalyzeResult>('/analyze', { method: 'POST', body: JSON.stringify({ command, useLlm }) }),
  nl2cmd: (instruction: string) => req<NlCommandResult>('/nl2cmd', { method: 'POST', body: JSON.stringify({ instruction }) }),

  getSettings: () => req<Settings>('/settings'),
  updateSettings: (patch: SettingsPatch) => req<Settings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  listModels: () => req<{ models: string[]; error?: string }>('/models'),
  testGateway: (llmBaseUrl: string, llmApiKey: string) =>
    req<{ models: string[]; error?: string }>('/gateway/test', {
      method: 'POST',
      body: JSON.stringify({ llmBaseUrl, llmApiKey }),
    }),

  logAudit: (entry: AuditLogInput) => req<AuditEntry>('/audit', { method: 'POST', body: JSON.stringify(entry) }),
  listAudit: (query: AuditQuery) => {
    const qs = new URLSearchParams()
    if (query.level) qs.set('level', query.level)
    if (query.hostId) qs.set('hostId', query.hostId)
    if (query.q) qs.set('q', query.q)
    if (query.limit) qs.set('limit', String(query.limit))
    if (query.offset) qs.set('offset', String(query.offset))
    return req<{ total: number; items: AuditEntry[] }>(`/audit?${qs.toString()}`)
  },

  listGroups: () => req<Group[]>('/groups'),
  createGroup: (name: string) => req<Group>('/groups', { method: 'POST', body: JSON.stringify({ name }) }),
  updateGroup: (id: string, name: string) =>
    req<Group>(`/groups/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteGroup: (id: string) => req<{ ok: true }>(`/groups/${id}`, { method: 'DELETE' }),

  listSnippets: () => req<Snippet[]>('/snippets'),
  createSnippet: (label: string, command: string) =>
    req<Snippet>('/snippets', { method: 'POST', body: JSON.stringify({ label, command }) }),
  updateSnippet: (id: string, label: string, command: string) =>
    req<Snippet>(`/snippets/${id}`, { method: 'PUT', body: JSON.stringify({ label, command }) }),
  deleteSnippet: (id: string) => req<{ ok: true }>(`/snippets/${id}`, { method: 'DELETE' }),

  sftpList: (hostId: string, path: string) =>
    req<{ path: string; entries: SftpEntry[] }>(`/sftp/${hostId}/list?path=${encodeURIComponent(path)}`),
  sftpMkdir: (hostId: string, path: string) =>
    req<{ ok: true }>(`/sftp/${hostId}/mkdir`, { method: 'POST', body: JSON.stringify({ path }) }),
  sftpRename: (hostId: string, from: string, to: string) =>
    req<{ ok: true }>(`/sftp/${hostId}/rename`, { method: 'POST', body: JSON.stringify({ from, to }) }),
  sftpRemove: (hostId: string, path: string) =>
    req<{ ok: true }>(`/sftp/${hostId}/remove?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),

  async sftpUpload(hostId: string, targetDir: string, file: File, relPath: string) {
    const fd = new FormData()
    fd.append('relPath', relPath)
    fd.append('file', file)
    const resp = await fetch(`/api/sftp/${hostId}/upload?path=${encodeURIComponent(targetDir)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: fd,
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error((data as any).error || '上传失败')
  },

  // ---- 连接导入/导出(兼容 Xshell) ----
  async importConnections(files: File[]): Promise<ImportResult> {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    const resp = await fetch('/api/connections/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: fd,
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error((data as any).error || '导入失败')
    return data as ImportResult
  },

  async exportConnections(ids?: string[]) {
    const qs = ids && ids.length ? `?ids=${encodeURIComponent(ids.join(','))}` : ''
    const resp = await fetch(`/api/connections/export${qs}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      throw new Error((data as any).error || '导出失败')
    }
    const disp = resp.headers.get('Content-Disposition') || ''
    const m = disp.match(/filename="?([^"]+)"?/)
    const filename = m ? decodeURIComponent(m[1]) : 'connections.zip'
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },

  async sftpDownload(hostId: string, remotePath: string, isDir: boolean) {
    const resp = await fetch(`/api/sftp/${hostId}/download?path=${encodeURIComponent(remotePath)}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      throw new Error((data as any).error || '下载失败')
    }
    const blob = await resp.blob()
    const base = remotePath.split('/').filter(Boolean).pop() || 'download'
    const filename = isDir ? `${base}.zip` : base
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}
