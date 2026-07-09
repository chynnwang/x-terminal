<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { api, type Host, type HostForm, type Group, type SecurityMode } from '../api'
import SecurityModal from './SecurityModal.vue'

const props = defineProps<{ activeId: string | null; openIds?: string[] }>()
const emit = defineEmits<{
  (e: 'connect', host: Host): void
  (e: 'logout'): void
  (e: 'update', host: Host): void
  (e: 'removed', hostId: string): void
}>()

const hosts = ref<Host[]>([])
const groups = ref<Group[]>([])
const error = ref('')
const showForm = ref(false)
const editingId = ref<string | null>(null)
const collapsedGroups = ref<Set<string>>(new Set())

const newGroupName = ref('')
const showNewGroup = ref(false)
const editingGroupId = ref<string | null>(null)
const editingGroupName = ref('')

const form = reactive<HostForm>({
  label: '',
  host: '',
  port: 22,
  username: 'root',
  authType: 'password',
  groupId: null,
  deviceType: 'server',
  secret: '',
  passphrase: '',
})

const DEVICE_TYPE_OPTIONS: { value: HostForm['deviceType']; label: string }[] = [
  { value: 'server', label: '服务器(Linux/Unix)' },
  { value: 'huawei', label: '华为' },
  { value: 'h3c', label: '华三' },
  { value: 'fortinet', label: '飞塔(Fortinet)' },
  { value: 'routeros', label: 'RouterOS(MikroTik)' },
  { value: 'aruba', label: 'Aruba AC/AP' },
  { value: 'other', label: '其他网络设备' },
]

const grouped = computed(() => {
  const map = new Map<string, Host[]>()
  for (const g of groups.value) map.set(g.id, [])
  const ungrouped: Host[] = []
  for (const h of hosts.value) {
    if (h.groupId && map.has(h.groupId)) map.get(h.groupId)!.push(h)
    else ungrouped.push(h)
  }
  return { map, ungrouped }
})

function isOpen(id: string): boolean {
  return Boolean(props.openIds?.includes(id)) && id !== props.activeId
}

// 当前安全模式:仅在设置了密码(mode==='password')时才显示「退出登录」;免密模式下退出没有意义
const securityMode = ref<SecurityMode>('none')
async function loadSecurityMode() {
  try {
    const s = await api.securityStatus()
    securityMode.value = s.mode
  } catch {
    /* 拿不到时按免密处理,不显示退出按钮 */
  }
}

async function load() {
  try {
    const [h, g] = await Promise.all([api.listHosts(), api.listGroups()])
    hosts.value = h
    groups.value = g
  } catch (e: any) {
    error.value = e.message
  }
}
onMounted(() => {
  load()
  loadSecurityMode()
})

// 安全设置弹窗关闭后,密码模式可能已被开启/关闭,重新拉一次状态以同步退出按钮的显隐
function onSecurityClosed() {
  showSecurity.value = false
  loadSecurityMode()
}

function toggleGroup(id: string) {
  if (collapsedGroups.value.has(id)) collapsedGroups.value.delete(id)
  else collapsedGroups.value.add(id)
  collapsedGroups.value = new Set(collapsedGroups.value)
}

async function addGroup() {
  const name = newGroupName.value.trim()
  if (!name) return
  try {
    await api.createGroup(name)
    newGroupName.value = ''
    showNewGroup.value = false
    await load()
  } catch (e: any) {
    error.value = e.message
  }
}

function startRenameGroup(g: Group) {
  editingGroupId.value = g.id
  editingGroupName.value = g.name
}
async function saveRenameGroup() {
  if (!editingGroupId.value) return
  const name = editingGroupName.value.trim()
  if (!name) return
  try {
    await api.updateGroup(editingGroupId.value, name)
    editingGroupId.value = null
    await load()
  } catch (e: any) {
    error.value = e.message
  }
}

async function removeGroup(g: Group) {
  if (!confirm(`删除分组「${g.name}」?组内主机会变为未分组,不会被删除。`)) return
  try {
    await api.deleteGroup(g.id)
    await load()
  } catch (e: any) {
    error.value = e.message
  }
}

function openCreate() {
  editingId.value = null
  Object.assign(form, {
    label: '',
    host: '',
    port: 22,
    username: 'root',
    authType: 'password',
    groupId: null,
    deviceType: 'server',
    secret: '',
    passphrase: '',
  })
  showForm.value = true
}

function openEdit(h: Host) {
  editingId.value = h.id
  Object.assign(form, {
    label: h.label,
    host: h.host,
    port: h.port,
    username: h.username,
    authType: h.authType,
    groupId: h.groupId,
    deviceType: h.deviceType,
    secret: '', // 留空表示不修改密码/私钥
    passphrase: '',
  })
  showForm.value = true
}

async function save() {
  error.value = ''
  try {
    if (editingId.value) {
      const patch: Partial<HostForm> = { ...form }
      if (!patch.secret) delete patch.secret // 留空不改
      const updated = await api.updateHost(editingId.value, patch)
      if (editingId.value === props.activeId || props.openIds?.includes(editingId.value)) emit('update', updated)
    } else {
      await api.createHost({ ...form })
    }
    showForm.value = false
    await load()
  } catch (e: any) {
    error.value = e.message
  }
}

async function remove(h: Host) {
  if (!confirm(`确认删除主机「${h.label || h.host}」?`)) return
  await api.deleteHost(h.id)
  emit('removed', h.id)
  await load()
}

// ---- 连接导入/导出(兼容 Xshell) ----
const showSecurity = ref(false)
const importInput = ref<HTMLInputElement | null>(null)

function triggerImport() {
  importInput.value?.click()
}

async function onImportFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  input.value = '' // 允许再次选同一文件
  if (!files.length) return
  error.value = ''
  try {
    const r = await api.importConnections(files)
    await load()
    const skipMsg = r.skipped.length ? `,${r.skipped.length} 个文件无法识别(已跳过)` : ''
    const groupMsg = r.groupsCreated ? `,新建 ${r.groupsCreated} 个分组` : ''
    alert(`已导入 ${r.imported} 台主机${groupMsg}${skipMsg}。请为导入的主机补填密码后再连接。`)
  } catch (e: any) {
    error.value = e.message || '导入失败'
  }
}

async function doExport() {
  error.value = ''
  if (!hosts.value.length) {
    error.value = '还没有主机可导出'
    return
  }
  try {
    await api.exportConnections() // 不传 ids = 导出全部,Xshell 兼容格式
  } catch (e: any) {
    error.value = e.message || '导出失败'
  }
}

async function doExportBackup() {
  error.value = ''
  if (!hosts.value.length) {
    error.value = '还没有主机可导出'
    return
  }
  try {
    await api.exportConnections(undefined, 'json') // 本工具 JSON 备份,含分组
  } catch (e: any) {
    error.value = e.message || '导出失败'
  }
}

</script>

<template>
  <div class="hostlist">
    <div class="head">
      <span class="title">主机</span>
      <div class="head-actions">
        <button class="new-group-btn" title="新增分组" @click="showNewGroup = !showNewGroup">📁+</button>
        <button class="btn" @click="openCreate">+ 新增</button>
      </div>
    </div>

    <div v-if="showNewGroup" class="new-group">
      <input v-model="newGroupName" placeholder="分组名称" @keyup.enter="addGroup" />
      <button class="mini" @click="addGroup">✔</button>
    </div>

    <div class="items">
      <template v-for="g in groups" :key="g.id">
        <div class="group-head" @click="toggleGroup(g.id)">
          <span class="arrow">{{ collapsedGroups.has(g.id) ? '▸' : '▾' }}</span>
          <template v-if="editingGroupId === g.id">
            <input
              v-model="editingGroupName"
              class="group-rename"
              @click.stop
              @keyup.enter="saveRenameGroup"
              @keyup.esc="editingGroupId = null"
            />
            <button class="mini" title="保存" @click.stop="saveRenameGroup">✔</button>
          </template>
          <template v-else>
            <span class="group-name">{{ g.name }}</span>
            <span class="group-count">{{ grouped.map.get(g.id)?.length ?? 0 }}</span>
            <span class="group-actions">
              <button class="mini" title="重命名" @click.stop="startRenameGroup(g)">✎</button>
              <button class="mini" title="删除分组" @click.stop="removeGroup(g)">🗑</button>
            </span>
          </template>
        </div>
        <div v-if="!collapsedGroups.has(g.id)">
          <div
            v-for="h in grouped.map.get(g.id)"
            :key="h.id"
            class="item"
            :class="{ active: h.id === props.activeId, open: isOpen(h.id) }"
            @click="emit('connect', h)"
          >
            <div class="item-main">
              <div class="label"><span v-if="isOpen(h.id)" class="open-dot" /> {{ h.label || h.host }}</div>
            </div>
            <div class="item-actions">
              <button class="mini" title="编辑" @click.stop="openEdit(h)">✎</button>
              <button class="mini" title="删除" @click.stop="remove(h)">🗑</button>
            </div>
          </div>
        </div>
      </template>

      <div v-if="grouped.ungrouped.length || !groups.length" class="group-head plain">
        <span class="arrow-spacer"></span>
        <span class="group-name">未分组</span>
      </div>
      <div
        v-for="h in grouped.ungrouped"
        :key="h.id"
        class="item"
        :class="{ active: h.id === props.activeId, open: isOpen(h.id) }"
        @click="emit('connect', h)"
      >
        <div class="item-main">
          <div class="label"><span v-if="isOpen(h.id)" class="open-dot" /> {{ h.label || h.host }}</div>
        </div>
        <div class="item-actions">
          <button class="mini" title="编辑" @click.stop="openEdit(h)">✎</button>
          <button class="mini" title="删除" @click.stop="remove(h)">🗑</button>
        </div>
      </div>

      <p v-if="!hosts.length" class="empty">还没有主机,点「+ 新增」添加一台。</p>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <div class="footer">
      <div class="footer-row">
        <button class="foot-btn" title="支持 Xshell 会话文件(.xsh,仅非密码字段)或本工具的 .json 备份(含分组)" @click="triggerImport">导入连接</button>
        <button class="foot-btn" title="导出全部连接为 Xshell 会话文件(不含密码,不含分组)" @click="doExport">导出连接</button>
        <button class="foot-btn" title="导出本工具 JSON 备份(含分组信息,不含密码)" @click="doExportBackup">导出备份</button>
      </div>
      <button class="foot-btn icon-text" title="修改密码 / 开关密码验证" @click="showSecurity = true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        安全设置
      </button>
      <button v-if="securityMode === 'password'" class="logout" @click="emit('logout')">退出登录</button>
    </div>

    <input
      ref="importInput"
      type="file"
      accept=".xsh,.json"
      multiple
      style="display: none"
      @change="onImportFiles"
    />

    <SecurityModal v-if="showSecurity" @close="onSecurityClosed" />

    <!-- 主机表单 -->
    <div v-if="showForm" class="modal-mask" @click.self="showForm = false">
      <div class="modal">
        <h3>{{ editingId ? '编辑主机' : '新增主机' }}</h3>
        <label>备注名</label>
        <input v-model="form.label" placeholder="例如:测试服务器" />
        <div class="row">
          <div style="flex: 3">
            <label>主机地址</label>
            <input v-model="form.host" placeholder="10.0.0.1 或 域名" />
          </div>
          <div style="flex: 1">
            <label>端口</label>
            <input v-model.number="form.port" type="number" />
          </div>
        </div>
        <label>用户名</label>
        <input v-model="form.username" />
        <label>分组</label>
        <select v-model="form.groupId">
          <option :value="null">无分组</option>
          <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>
        <label>设备类型</label>
        <select v-model="form.deviceType">
          <option v-for="opt in DEVICE_TYPE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <label>认证方式</label>
        <select v-model="form.authType">
          <option value="password">密码</option>
          <option value="key">私钥</option>
        </select>
        <template v-if="form.authType === 'password'">
          <label>密码 {{ editingId ? '(留空则不修改)' : '' }}</label>
          <input v-model="form.secret" type="password" />
        </template>
        <template v-else>
          <label>私钥内容 {{ editingId ? '(留空则不修改)' : '' }}</label>
          <textarea v-model="form.secret" rows="4" placeholder="粘贴 PEM/OpenSSH 私钥"></textarea>
          <label>私钥口令(可选)</label>
          <input v-model="form.passphrase" type="password" />
        </template>
        <div class="modal-actions">
          <button class="btn ghost" @click="showForm = false">取消</button>
          <button class="btn" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hostlist {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-soft);
  border-right: 1px solid var(--border);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}
.head-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
/* 头部两个按钮统一为精致胶囊:同高、同圆角、描边风格 */
.head-actions > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 30px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  padding: 0 12px;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.title {
  font-weight: 600;
}
.new-group {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.new-group input {
  flex: 1;
}
.items {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 6px;
  cursor: pointer;
  border-radius: 6px;
  color: var(--text-dim);
  font-size: 12px;
  margin-top: 4px;
}
.group-head:hover {
  background: var(--bg-panel);
}
.group-head.plain {
  cursor: default;
}
.arrow {
  width: 22px;
  flex: none;
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
}
.arrow-spacer {
  width: 22px;
  flex: none;
}
.group-name {
  font-weight: 600;
  flex: 1;
}
.group-count {
  font-size: 11px;
  color: var(--text-dim);
}
.group-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
}
.group-head:hover .group-actions {
  opacity: 1;
}
.group-rename {
  flex: 1;
  padding: 2px 6px;
}
.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 10px 9px 22px;
  border-radius: 8px;
  cursor: pointer;
}
.item:hover {
  background: var(--bg-panel);
}
.item.active {
  background: rgba(79, 140, 255, 0.15);
  outline: 1px solid var(--accent);
}
.item.open {
  background: rgba(63, 185, 80, 0.08);
}
.open-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--safe);
  margin-right: 2px;
}
.label {
  font-weight: 500;
}
.item-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
}
.item:hover .item-actions {
  opacity: 1;
}
.mini {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 13px;
  padding: 2px 4px;
}
.mini:hover {
  color: var(--text);
}
/* 分组按钮:纯图标,窄一点 */
.head-actions .new-group-btn {
  padding: 0 10px;
  font-size: 14px;
}
.head-actions .new-group-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(79, 140, 255, 0.08);
}
/* 新增按钮:主操作,淡蓝底 + 蓝色描边,hover 加深(不再是大块实心蓝) */
.head-actions .btn {
  color: var(--accent);
  border-color: rgba(79, 140, 255, 0.4);
  background: rgba(79, 140, 255, 0.1);
}
.head-actions .btn:hover {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
  filter: none;
}
.empty {
  color: var(--text-dim);
  font-size: 12px;
  padding: 8px;
}
.err {
  color: var(--danger);
  font-size: 12px;
  padding: 0 12px;
}
.footer {
  border-top: 1px solid var(--border);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.footer-row {
  display: flex;
  gap: 6px;
}
.foot-btn {
  flex: 1;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 6px;
  padding: 7px;
  font-size: 12px;
}
.foot-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(79, 140, 255, 0.08);
}
.foot-btn.icon-text {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.foot-btn.icon-text svg {
  flex: none;
}
.logout {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 6px;
  padding: 7px;
}
.logout:hover {
  color: var(--text);
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  width: 380px;
  max-height: 90vh;
  overflow-y: auto;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
}
.modal h3 {
  margin: 0 0 12px;
}
.modal label {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
  margin: 10px 0 4px;
}
.modal textarea {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 8px 10px;
  font-family: monospace;
  font-size: 12px;
}
.row {
  display: flex;
  gap: 10px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
</style>
