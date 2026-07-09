<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { api, type Host, type SftpEntry } from '../api'

const props = defineProps<{ host: Host | null }>()

const currentPath = ref('/')
const pathInput = ref('/')
const entries = ref<SftpEntry[]>([])
const loading = ref(false)
const error = ref('')

const fileInputRef = ref<HTMLInputElement | null>(null)
const folderInputRef = ref<HTMLInputElement | null>(null)

const uploadStatus = reactive({ active: false, current: 0, total: 0, name: '' })

const promptModal = reactive<{ open: boolean; title: string; value: string; action: ((v: string) => void) | null }>({
  open: false,
  title: '',
  value: '',
  action: null,
})

function dirnameOf(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  if (!trimmed) return '/'
  const idx = trimmed.lastIndexOf('/')
  if (idx <= 0) return '/'
  return trimmed.slice(0, idx)
}
function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}
function formatTime(ms: number): string {
  if (!ms) return '-'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load(path: string) {
  if (!props.host) return
  loading.value = true
  error.value = ''
  try {
    const r = await api.sftpList(props.host.id, path)
    currentPath.value = r.path
    pathInput.value = r.path
    entries.value = r.entries
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function refresh() {
  load(currentPath.value)
}
function goUp() {
  load(dirnameOf(currentPath.value))
}
function enterDir(e: SftpEntry) {
  if (e.type !== 'dir') return
  load(joinPath(currentPath.value, e.name))
}
function goToInput() {
  load(pathInput.value.trim() || '/')
}

function openPrompt(title: string, initial: string, action: (v: string) => void) {
  promptModal.title = title
  promptModal.value = initial
  promptModal.action = action
  promptModal.open = true
}
function confirmPrompt() {
  const v = promptModal.value.trim()
  promptModal.open = false
  if (v && promptModal.action) promptModal.action(v)
}

function newFolder() {
  openPrompt('新建文件夹', '', async (name) => {
    if (!props.host) return
    try {
      await api.sftpMkdir(props.host.id, joinPath(currentPath.value, name))
      refresh()
    } catch (e: any) {
      error.value = e.message
    }
  })
}

function renameEntry(e: SftpEntry) {
  openPrompt('重命名', e.name, async (name) => {
    if (!props.host) return
    try {
      await api.sftpRename(props.host.id, joinPath(currentPath.value, e.name), joinPath(currentPath.value, name))
      refresh()
    } catch (err: any) {
      error.value = err.message
    }
  })
}

async function deleteEntry(e: SftpEntry) {
  if (!props.host) return
  if (!confirm(`确认删除「${e.name}」?${e.type === 'dir' ? '(将递归删除整个目录)' : ''}`)) return
  try {
    await api.sftpRemove(props.host.id, joinPath(currentPath.value, e.name))
    refresh()
  } catch (err: any) {
    error.value = err.message
  }
}

async function downloadEntry(e: SftpEntry) {
  if (!props.host) return
  try {
    await api.sftpDownload(props.host.id, joinPath(currentPath.value, e.name), e.type === 'dir')
  } catch (err: any) {
    error.value = err.message
  }
}

async function uploadFileList(files: File[], useRelPath: boolean) {
  if (!props.host || !files.length) return
  uploadStatus.active = true
  uploadStatus.total = files.length
  uploadStatus.current = 0
  error.value = ''
  try {
    for (const file of files) {
      uploadStatus.current += 1
      uploadStatus.name = file.name
      const relPath = useRelPath ? (file as any).webkitRelativePath || file.name : file.name
      await api.sftpUpload(props.host.id, currentPath.value, file, relPath)
    }
    refresh()
  } catch (e: any) {
    error.value = e.message
  } finally {
    uploadStatus.active = false
  }
}

function onPickFiles(ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  uploadFileList(files, false)
}
function onPickFolder(ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  uploadFileList(files, true)
}

watch(
  () => props.host,
  (h) => {
    if (h) load('.')
    else {
      entries.value = []
      currentPath.value = '/'
    }
  },
)
onMounted(() => {
  if (props.host) load('.')
})
</script>

<template>
  <div class="filemgr">
    <div class="toolbar">
      <button class="btn ghost" :disabled="currentPath === '/'" @click="goUp">⬆ 上级</button>
      <input class="path-input" v-model="pathInput" @keyup.enter="goToInput" />
      <button class="btn ghost" @click="refresh">刷新</button>
      <button class="btn ghost" @click="newFolder">新建文件夹</button>
      <button class="btn ghost" @click="fileInputRef?.click()">上传文件</button>
      <button class="btn ghost" @click="folderInputRef?.click()">上传文件夹</button>
      <input ref="fileInputRef" type="file" multiple style="display: none" @change="onPickFiles" />
      <input
        ref="folderInputRef"
        type="file"
        webkitdirectory
        multiple
        style="display: none"
        @change="onPickFolder"
      />
    </div>

    <p v-if="uploadStatus.active" class="upload-status">
      上传中 {{ uploadStatus.current }}/{{ uploadStatus.total }}:{{ uploadStatus.name }}
    </p>
    <p v-if="error" class="err">{{ error }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th style="width: 100px">大小</th>
            <th style="width: 140px">修改时间</th>
            <th style="width: 160px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in entries" :key="e.name">
            <td class="name" :class="{ dir: e.type === 'dir' }" @click="enterDir(e)">
              <span class="icon">{{ e.type === 'dir' ? '📁' : '📄' }}</span>{{ e.name }}
            </td>
            <td>{{ e.type === 'dir' ? '-' : formatSize(e.size) }}</td>
            <td class="dim">{{ formatTime(e.mtime) }}</td>
            <td class="actions">
              <button class="mini" @click.stop="downloadEntry(e)">下载</button>
              <button class="mini" @click.stop="renameEntry(e)">重命名</button>
              <button class="mini" @click.stop="deleteEntry(e)">删除</button>
            </td>
          </tr>
          <tr v-if="!loading && !entries.length">
            <td colspan="4" class="empty">空目录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="promptModal.open" class="modal-mask" @click.self="promptModal.open = false">
      <div class="modal">
        <h3>{{ promptModal.title }}</h3>
        <input v-model="promptModal.value" autofocus @keyup.enter="confirmPrompt" />
        <div class="modal-actions">
          <button class="btn ghost" @click="promptModal.open = false">取消</button>
          <button class="btn" @click="confirmPrompt">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.filemgr {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow: hidden;
  background: #0f1115;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}
.path-input {
  flex: 1;
  font-family: monospace;
  font-size: 12px;
}
.upload-status {
  font-size: 12px;
  color: var(--accent);
  margin: 0 0 8px;
}
.err {
  color: var(--danger);
  font-size: 12px;
  margin: 0 0 8px;
}
.table-wrap {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th {
  position: sticky;
  top: 0;
  background: var(--bg-soft);
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  font-weight: 500;
}
td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
}
.name {
  cursor: default;
}
.name.dir {
  cursor: pointer;
  color: var(--accent);
}
.icon {
  margin-right: 6px;
}
.dim {
  color: var(--text-dim);
}
.actions {
  display: flex;
  gap: 6px;
}
.mini {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 12px;
}
.mini:hover {
  color: var(--text);
}
.empty {
  text-align: center;
  color: var(--text-dim);
  padding: 30px 0;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.modal {
  width: 320px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
}
.modal h3 {
  margin: 0 0 12px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
</style>
