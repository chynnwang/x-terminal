<script setup lang="ts">
import { ref, computed } from 'vue'
import type { AnalyzeResult } from '../api'

const props = defineProps<{
  command: string
  result: AnalyzeResult | null
  loading: boolean
  llmEnabled: boolean
  aiRealtime: boolean
  blockDanger: boolean
  snippetsBar: boolean
  panelHeight: number
}>()
const emit = defineEmits<{
  (e: 'update:aiRealtime', v: boolean): void
  (e: 'update:blockDanger', v: boolean): void
  (e: 'update:snippetsBar', v: boolean): void
  (e: 'apply-suggestion', command: string): void
  (e: 'resize-start'): void
  (e: 'resize', delta: number): void
  (e: 'resize-end'): void
}>()

const collapsed = ref(false)
const levelText: Record<string, string> = { safe: '安全', caution: '需谨慎', danger: '高危' }
// AI 判断的拼写建议更准,优先用它;没有的话用本地知识库的模糊匹配结果
const suggestion = computed(() => props.result?.llm?.suggestion || props.result?.explain?.suggestion || '')

// 拖拽分隔条:鼠标按住后,随鼠标上下移动调整面板高度(delta>0 表示鼠标下移=>面板变矮)
const dragging = ref(false)
function onResizerDown(e: MouseEvent) {
  dragging.value = true
  emit('resize-start')
  const onMove = (ev: MouseEvent) => emit('resize', e.clientY - ev.clientY)
  const onUp = () => {
    dragging.value = false
    emit('resize-end')
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'row-resize'
}
</script>

<template>
  <div class="panel" :class="{ collapsed }" :style="{ height: collapsed ? '40px' : panelHeight + 'px' }">
    <div
      v-if="!collapsed"
      class="resizer"
      :class="{ dragging }"
      title="按住上下拖动可调整终端和解读面板的高度"
      @mousedown="onResizerDown"
    ></div>
    <div class="head-row">
      <span class="title">命令解读</span>
      <template v-if="command.trim()">
        <span class="cmd"><code>{{ command }}</code></span>
        <span v-if="result" class="tag" :class="result.level">{{ levelText[result.level] }}</span>
        <span v-if="loading" class="loading">分析中…</span>
      </template>
      <span v-else class="idle-hint">在终端里输入命令,这里会实时显示含义和风险</span>

      <div class="toggles">
        <label class="tg">
          <input
            type="checkbox"
            :checked="snippetsBar"
            @change="emit('update:snippetsBar', ($event.target as HTMLInputElement).checked)"
          />
          快捷命令
        </label>
        <label class="tg">
          <input
            type="checkbox"
            :checked="aiRealtime"
            :disabled="!llmEnabled"
            @change="emit('update:aiRealtime', ($event.target as HTMLInputElement).checked)"
          />
          AI 实时解读{{ llmEnabled ? '' : '(网关未配置)' }}
        </label>
        <label class="tg">
          <input
            type="checkbox"
            :checked="blockDanger"
            @change="emit('update:blockDanger', ($event.target as HTMLInputElement).checked)"
          />
          高危拦截
        </label>
      </div>
      <button class="collapse-btn" @click="collapsed = !collapsed">{{ collapsed ? '展开 ▴' : '收起 ▾' }}</button>
    </div>

    <div v-if="!collapsed && suggestion" class="suggestion-banner">
      💡 你是否想输入 <code>{{ suggestion }}</code>?
      <button class="fix-btn" @click="emit('apply-suggestion', suggestion)">一键改正</button>
    </div>

    <div v-show="!collapsed" class="content-row">
      <div v-if="result && result.explain" class="col explain">
        <div class="sec-title">本地解读(无需联网)</div>
        <div class="explain-summary">{{ result.explain.summary }}</div>
        <div class="explain-detail">{{ result.explain.detail }}</div>
      </div>

      <div v-if="result && result.local.matched.length" class="col rules">
        <div class="sec-title">本地规则命中</div>
        <div v-for="(m, i) in result.local.matched" :key="i" class="rule">
          <div class="rule-title">⚠ {{ m.title }}</div>
          <div class="rule-reason">{{ m.reason }}</div>
        </div>
      </div>

      <div v-if="result && result.llm" class="col ai">
        <div class="sec-title">AI 解读</div>
        <div class="llm-summary">{{ result.llm.summary }}</div>
        <div class="llm-detail">{{ result.llm.detail }}</div>
        <div v-if="result.llm.riskReason" class="llm-risk">风险:{{ result.llm.riskReason }}</div>
      </div>

      <div v-if="result && result.llmError" class="col err">AI 解读失败:{{ result.llmError }}</div>
      <div v-else-if="result && !result.llm && !aiRealtime && !result.explain" class="col hint">
        本地知识库暂未收录此命令,可开启「AI 实时解读」获取解释。
      </div>

      <div v-if="!command.trim()" class="col idle">在终端里开始输入命令,这里会实时显示它的含义和风险。</div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-soft);
  border-top: 1px solid var(--border);
  flex: none;
  min-height: 40px;
  position: relative;
}
.panel.collapsed {
  height: 40px;
}
.resizer {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  cursor: row-resize;
  z-index: 5;
}
.resizer::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 36px;
  height: 2px;
  border-radius: 1px;
  background: var(--border);
  transition: background 0.15s;
}
.resizer:hover::before,
.resizer.dragging::before {
  background: var(--accent);
}
.head-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  height: 40px;
  flex: none;
  border-bottom: 1px solid var(--border);
}
.title {
  font-weight: 600;
  font-size: 13px;
  flex: none;
}
.cmd code {
  font-family: monospace;
  font-size: 12px;
  color: #e6b673;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 6px;
}
.idle-hint {
  color: var(--text-dim);
  font-size: 12px;
}
.loading {
  color: var(--text-dim);
  font-size: 12px;
}
.toggles {
  margin-left: auto;
  display: flex;
  gap: 14px;
}
.tg {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
  white-space: nowrap;
}
.collapse-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  flex: none;
}
.collapse-btn:hover {
  color: var(--text);
}

.suggestion-banner {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(210, 153, 34, 0.12);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  color: var(--caution);
}
.suggestion-banner code {
  font-family: monospace;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 6px;
  color: var(--safe);
}
.fix-btn {
  margin-left: auto;
  background: var(--caution);
  color: #1a1400;
  border: none;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
}
.fix-btn:hover {
  filter: brightness(1.08);
}

.content-row {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 16px;
  padding: 10px 14px;
  overflow-y: auto;
}
.col {
  flex: 1;
  min-width: 0;
}
.sec-title {
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.rule {
  border-left: 2px solid var(--caution);
  padding: 3px 0 3px 10px;
  margin-bottom: 8px;
}
.rule-title {
  font-size: 13px;
  color: var(--caution);
}
.rule-reason {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
  line-height: 1.5;
}
.llm-summary {
  font-weight: 500;
  margin-bottom: 6px;
  font-size: 13px;
}
.llm-detail {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-wrap;
}
.llm-risk {
  margin-top: 8px;
  font-size: 12px;
  color: var(--danger);
  line-height: 1.5;
}
.explain-summary {
  font-weight: 500;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--safe);
}
.explain-detail {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-wrap;
}
.col.err {
  color: var(--caution);
  font-size: 12px;
}
.col.hint,
.col.idle {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}
</style>
