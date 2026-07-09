<script setup lang="ts">
import { ref } from 'vue'
import { api, type NlCommandResult } from '../api'

const props = defineProps<{ llmEnabled: boolean }>()
const emit = defineEmits<{ (e: 'insert', command: string): void }>()

const instruction = ref('')
const loading = ref(false)
const error = ref('')
const result = ref<NlCommandResult | null>(null)
const copied = ref(false)

const levelText: Record<string, string> = { safe: '安全', caution: '需谨慎', danger: '高危' }

async function generate() {
  const text = instruction.value.trim()
  if (!text) return
  if (!props.llmEnabled) {
    error.value = '该功能需要先在设置里配置大模型网关'
    return
  }
  loading.value = true
  error.value = ''
  result.value = null
  try {
    result.value = await api.nl2cmd(text)
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function insert() {
  if (!result.value) return
  emit('insert', result.value.command)
}

async function copy() {
  if (!result.value) return
  try {
    await navigator.clipboard.writeText(result.value.command)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* 剪贴板不可用则忽略 */
  }
}
</script>

<template>
  <div class="super-term">
    <div class="row">
      <span class="badge">
        <svg class="sparkle-icon" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2L13.8 9.2L21 11L13.8 12.8L12 20L10.2 12.8L3 11L10.2 9.2L12 2Z"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
        </svg>
        想做什么?
      </span>
      <input
        v-model="instruction"
        class="nl-input"
        placeholder="比如:我需要看一下 ip 地址"
        :disabled="loading"
        @keyup.enter="generate"
      />
      <button class="btn" :disabled="loading || !instruction.trim()" @click="generate">
        {{ loading ? '生成中…' : '生成命令' }}
      </button>
    </div>

    <p v-if="!llmEnabled" class="hint">该功能必须依赖大模型网关(本地知识库无法凭空生成命令),请先在顶部齿轮设置里配置。</p>
    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="result" class="result">
      <div class="result-head">
        <code class="cmd">{{ result.command }}</code>
        <span class="tag" :class="result.risk.level">{{ levelText[result.risk.level] }}</span>
      </div>
      <div v-if="result.explanation" class="explain">{{ result.explanation }}</div>
      <div v-if="result.risk.matched.length" class="risk-notes">
        <span v-for="(m, i) in result.risk.matched" :key="i">⚠ {{ m.title }}:{{ m.reason }}</span>
      </div>
      <div class="actions">
        <button class="btn" @click="insert">插入到终端</button>
        <button class="btn ghost" @click="copy">{{ copied ? '已复制' : '复制' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.super-term {
  flex: none;
  background: var(--bg-soft);
  border-top: 1px solid rgba(79, 140, 255, 0.55);
  padding: 10px 14px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  white-space: nowrap;
}
.sparkle-icon {
  width: 13px;
  height: 13px;
  flex: none;
}
.nl-input {
  flex: 1;
  border: 1px solid rgba(79, 140, 255, 0.55);
}
.nl-input:focus {
  border-color: var(--accent);
}
.hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--caution);
}
.err {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--danger);
}
.result {
  margin-top: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
}
.result-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cmd {
  flex: 1;
  font-family: monospace;
  font-size: 12px;
  color: #e6b673;
  word-break: break-all;
}
.explain {
  margin-top: 5px;
  font-size: 11px;
  color: var(--text-dim);
  line-height: 1.4;
}
.risk-notes {
  margin-top: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--caution);
}
.actions {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}
.actions .btn {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 5px;
}
</style>
