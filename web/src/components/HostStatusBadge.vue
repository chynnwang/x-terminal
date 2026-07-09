<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { api, type Host, type HostStats } from '../api'

const props = defineProps<{ host: Host | null }>()

const stats = ref<HostStats | null>(null)
const loading = ref(false)
let timer: number | null = null

const DEVICE_LABELS: Record<string, string> = {
  huawei: '华为',
  h3c: '华三',
  fortinet: '飞塔',
  routeros: 'RouterOS',
  aruba: 'Aruba',
  other: '网络设备',
}

function stopPolling() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

async function fetchStats(hostId: string) {
  loading.value = !stats.value
  try {
    stats.value = await api.hostStats(hostId)
  } catch {
    stats.value = { cpuPercent: null, memPercent: null, diskPercent: null, error: '获取失败' }
  } finally {
    loading.value = false
  }
}

function startPolling(hostId: string) {
  stopPolling()
  stats.value = null
  fetchStats(hostId)
  timer = window.setInterval(() => fetchStats(hostId), 8000)
}

watch(
  () => props.host,
  (h) => {
    stopPolling()
    stats.value = null
    if (h && (!h.deviceType || h.deviceType === 'server')) {
      startPolling(h.id)
    }
  },
  { immediate: true },
)

onBeforeUnmount(stopPolling)

function levelClass(v: number | null): string {
  if (v === null) return ''
  if (v >= 90) return 'danger'
  if (v >= 70) return 'caution'
  return 'ok'
}
</script>

<template>
  <div v-if="host" class="status-badge">
    <template v-if="!host.deviceType || host.deviceType === 'server'">
      <template v-if="stats && !stats.error">
        <span class="metric" :class="levelClass(stats.cpuPercent)">
          CPU {{ stats.cpuPercent === null ? '-' : `${stats.cpuPercent}%` }}
        </span>
        <span class="metric" :class="levelClass(stats.memPercent)">
          内存 {{ stats.memPercent === null ? '-' : `${stats.memPercent}%` }}
        </span>
        <span class="metric" :class="levelClass(stats.diskPercent)">
          磁盘 {{ stats.diskPercent === null ? '-' : `${stats.diskPercent}%` }}
        </span>
      </template>
      <span v-else-if="stats?.error" class="metric err" :title="stats.error">资源信息获取失败</span>
      <span v-else-if="loading" class="metric dim">加载中…</span>
    </template>
    <span v-else class="vendor-badge">🔧 {{ DEVICE_LABELS[host.deviceType] || host.deviceType }}</span>
  </div>
</template>

<style scoped>
.status-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 12px;
  font-size: 12px;
}
.metric {
  color: var(--text-dim);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 2px 9px;
  white-space: nowrap;
}
.metric.ok {
  color: var(--safe);
}
.metric.caution {
  color: var(--caution);
}
.metric.danger {
  color: var(--danger);
}
.metric.err {
  color: var(--text-dim);
}
.metric.dim {
  color: var(--text-dim);
}
.vendor-badge {
  color: var(--accent);
  background: rgba(79, 140, 255, 0.12);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 2px 9px;
  white-space: nowrap;
}
</style>
