<script setup lang="ts">
import type { AnalyzeResult } from '../api'

defineProps<{
  command: string
  result: AnalyzeResult | null
  llmLoading: boolean
}>()
const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <div class="mask">
    <div class="dialog">
      <div class="title">⚠ 高危命令确认</div>
      <p class="lead">即将执行以下命令,请确认无误:</p>
      <div class="cmd"><code>{{ command }}</code></div>

      <div v-if="result" class="reasons">
        <div v-for="(m, i) in result.local.matched" :key="i" class="reason">
          <b>{{ m.title }}</b> — {{ m.reason }}
        </div>
      </div>

      <div class="ai">
        <div class="ai-title">AI 解读</div>
        <div v-if="llmLoading" class="dim">分析中…</div>
        <template v-else-if="result && result.llm">
          <div>{{ result.llm.detail }}</div>
          <div v-if="result.llm.riskReason" class="ai-risk">风险:{{ result.llm.riskReason }}</div>
        </template>
        <div v-else class="dim">(无 AI 解读)</div>
      </div>

      <div class="actions">
        <button class="btn ghost" @click="emit('cancel')">取消 (不执行)</button>
        <button class="btn danger" @click="emit('confirm')">确认执行</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  width: 460px;
  max-height: 88vh;
  overflow-y: auto;
  background: var(--bg-panel);
  border: 1px solid var(--danger);
  border-radius: 12px;
  padding: 22px;
}
.title {
  font-size: 17px;
  font-weight: 700;
  color: var(--danger);
  margin-bottom: 12px;
}
.lead {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--text-dim);
}
.cmd {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  word-break: break-all;
}
.cmd code {
  font-family: monospace;
  color: #e6b673;
}
.reasons {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.reason {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
  border-left: 2px solid var(--danger);
  padding-left: 10px;
}
.ai {
  margin-top: 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.ai-title {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.ai div {
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.ai-risk {
  margin-top: 8px;
  color: var(--danger);
}
.dim {
  color: var(--text-dim);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
</style>
