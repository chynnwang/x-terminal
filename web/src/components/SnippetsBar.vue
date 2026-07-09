<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue'
import { api, type Snippet } from '../api'

const emit = defineEmits<{ (e: 'run', command: string): void }>()

const snippets = ref<Snippet[]>([])
const loading = ref(false)
const error = ref('')
const showEditor = ref(false)
const editingId = ref<string | null>(null)
const form = reactive({ label: '', command: '' })

async function load() {
  loading.value = true
  error.value = ''
  try {
    snippets.value = await api.listSnippets()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

function openCreate() {
  editingId.value = null
  form.label = ''
  form.command = ''
  showEditor.value = true
}
function openEdit(s: Snippet) {
  editingId.value = s.id
  form.label = s.label
  form.command = s.command
  showEditor.value = true
}

async function save() {
  if (!form.command.trim()) {
    error.value = '命令不能为空'
    return
  }
  try {
    if (editingId.value) {
      await api.updateSnippet(editingId.value, form.label, form.command)
    } else {
      await api.createSnippet(form.label, form.command)
    }
    showEditor.value = false
    await load()
  } catch (e: any) {
    error.value = e.message
  }
}

async function remove(s: Snippet) {
  if (!confirm(`删除快捷命令「${s.label}」?`)) return
  await api.deleteSnippet(s.id)
  await load()
}
</script>

<template>
  <div class="snippets-bar">
    <span class="bar-label">快捷命令</span>
    <div class="btns">
      <template v-if="snippets.length">
        <button
          v-for="s in snippets"
          :key="s.id"
          class="snippet-btn"
          :title="s.command"
          @click="emit('run', s.command)"
          @contextmenu.prevent="openEdit(s)"
        >
          {{ s.label }}
        </button>
      </template>
      <span v-else-if="!loading" class="empty">还没有快捷命令,点「+ 管理」添加常用命令</span>
    </div>
    <button class="manage-btn" @click="openCreate">+ 管理</button>

    <div v-if="showEditor" class="modal-mask" @click.self="showEditor = false">
      <div class="modal">
        <h3>{{ editingId ? '编辑快捷命令' : '新增快捷命令' }}</h3>
        <label>按钮名称(留空则用命令前20字)</label>
        <input v-model="form.label" placeholder="例如:看日志" />
        <label>命令内容</label>
        <textarea v-model="form.command" rows="3" placeholder="例如:tail -f /var/log/syslog"></textarea>
        <p v-if="error" class="err">{{ error }}</p>
        <div class="modal-actions">
          <button v-if="editingId" class="btn ghost danger" @click="remove(snippets.find((s) => s.id === editingId)!); showEditor = false">
            删除
          </button>
          <span style="flex: 1"></span>
          <button class="btn ghost" @click="showEditor = false">取消</button>
          <button class="btn" @click="save">保存</button>
        </div>
        <p class="tip">已保存的快捷命令列表(右键按钮也可编辑):</p>
        <div class="snippet-list">
          <div v-for="s in snippets" :key="s.id" class="snippet-row" @click="openEdit(s)">
            <span class="row-label">{{ s.label }}</span>
            <code class="row-cmd">{{ s.command }}</code>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.snippets-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: var(--bg-soft);
  border-top: 1px solid var(--border);
  overflow-x: auto;
}
.bar-label {
  font-size: 12px;
  color: var(--text-dim);
  flex: none;
  font-weight: 600;
}
.btns {
  display: flex;
  gap: 6px;
  flex: 1;
  align-items: center;
  overflow-x: auto;
}
.snippet-btn {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  white-space: nowrap;
  flex: none;
}
.snippet-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.empty {
  font-size: 12px;
  color: var(--text-dim);
}
.manage-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  flex: none;
}
.manage-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
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
  width: 440px;
  max-height: 85vh;
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
  resize: vertical;
}
.err {
  color: var(--danger);
  font-size: 12px;
  margin: 8px 0 0;
}
.modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  align-items: center;
}
.modal-actions .btn.danger {
  background: var(--danger);
}
.tip {
  font-size: 12px;
  color: var(--text-dim);
  margin: 18px 0 6px;
}
.snippet-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.snippet-row {
  display: flex;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.snippet-row:hover {
  background: var(--bg);
}
.row-label {
  color: var(--accent);
  min-width: 80px;
}
.row-cmd {
  font-family: monospace;
  color: #e6b673;
  word-break: break-all;
}
</style>
