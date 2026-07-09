<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { api, type AuditEntry, type Host } from '../api'

const items = ref<AuditEntry[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')

const hosts = ref<Host[]>([])
const level = ref<'all' | 'safe' | 'caution' | 'danger'>('all')
const hostId = ref('')
const keyword = ref('')
const pageSize = 50
const offset = ref(0)

const levelText: Record<string, string> = { safe: '安全', caution: '需谨慎', danger: '高危' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await api.listAudit({
      level: level.value === 'all' ? undefined : level.value,
      hostId: hostId.value || undefined,
      q: keyword.value.trim() || undefined,
      limit: pageSize,
      offset: offset.value,
    })
    items.value = r.items
    total.value = r.total
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function resetAndLoad() {
  offset.value = 0
  load()
}

let debounceTimer: number | null = null
watch(keyword, () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(resetAndLoad, 350)
})
watch([level, hostId], resetAndLoad)

function prevPage() {
  offset.value = Math.max(0, offset.value - pageSize)
  load()
}
function nextPage() {
  if (offset.value + pageSize >= total.value) return
  offset.value += pageSize
  load()
}

function fmtTime(ts: number) {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

onMounted(async () => {
  try {
    hosts.value = await api.listHosts()
  } catch {
    /* ignore */
  }
  load()
})
</script>

<template>
  <div class="audit">
    <div class="toolbar">
      <select v-model="level">
        <option value="all">全部风险等级</option>
        <option value="safe">仅安全</option>
        <option value="caution">仅需谨慎</option>
        <option value="danger">仅高危</option>
      </select>
      <select v-model="hostId">
        <option value="">全部主机</option>
        <option v-for="h in hosts" :key="h.id" :value="h.id">{{ h.label || h.host }}</option>
      </select>
      <input v-model="keyword" placeholder="按命令关键词搜索…" style="max-width: 260px" />
      <button class="btn ghost" @click="resetAndLoad">刷新</button>
      <span class="total">共 {{ total }} 条</span>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width: 150px">时间</th>
            <th style="width: 130px">主机</th>
            <th>命令</th>
            <th style="width: 80px">风险</th>
            <th style="width: 70px">执行</th>
            <th style="width: 260px">说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in items" :key="e.id">
            <td class="dim">{{ fmtTime(e.ts) }}</td>
            <td>{{ e.hostLabel }}</td>
            <td class="cmd"><code>{{ e.command }}</code></td>
            <td><span class="tag" :class="e.level">{{ levelText[e.level] }}</span></td>
            <td>
              <span v-if="e.executed" class="exec-yes">已执行</span>
              <span v-else class="exec-no">已取消</span>
            </td>
            <td class="note">
              <span v-if="e.ruleTitles.length">{{ e.ruleTitles.join('、') }}</span>
              <span v-if="e.llmSummary" class="ai-note"> · {{ e.llmSummary }}</span>
            </td>
          </tr>
          <tr v-if="!loading && !items.length">
            <td colspan="6" class="empty">暂无记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pager">
      <button class="btn ghost" :disabled="offset === 0" @click="prevPage">上一页</button>
      <span class="dim">{{ items.length ? offset + 1 : 0 }}-{{ offset + items.length }} / {{ total }}</span>
      <button class="btn ghost" :disabled="offset + pageSize >= total" @click="nextPage">下一页</button>
    </div>
  </div>
</template>

<style scoped>
.audit {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.toolbar select,
.toolbar input {
  width: auto;
}
.total {
  margin-left: auto;
  color: var(--text-dim);
  font-size: 12px;
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
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.cmd code {
  font-family: monospace;
  color: #e6b673;
  word-break: break-all;
}
.dim {
  color: var(--text-dim);
}
.exec-yes {
  color: var(--safe);
  font-size: 12px;
}
.exec-no {
  color: var(--text-dim);
  font-size: 12px;
}
.note {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}
.ai-note {
  color: var(--text);
}
.empty {
  text-align: center;
  color: var(--text-dim);
  padding: 30px 0;
}
.err {
  color: var(--danger);
  font-size: 12px;
}
.pager {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: center;
  padding-top: 12px;
}
</style>
