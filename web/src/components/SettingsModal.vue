<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '../api'

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', model: string): void }>()

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const error = ref('')
const testMessage = ref('')
const showApiKey = ref(false)

const llmEnabled = ref(false)
const currentModel = ref('')

const baseUrl = ref('')
const apiKey = ref('')
const selectedModel = ref('')
const customModel = ref('')
const models = ref<string[]>([])

onMounted(async () => {
  try {
    const s = await api.getSettings()
    llmEnabled.value = s.llmEnabled
    currentModel.value = s.model
    baseUrl.value = s.llmBaseUrl
    apiKey.value = s.llmApiKey
    selectedModel.value = s.model
    const m = await api.listModels()
    models.value = m.models
    if (!models.value.includes(s.model) && s.model) {
      selectedModel.value = '__custom__'
      customModel.value = s.model
    }
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

async function testConnection() {
  error.value = ''
  testMessage.value = ''
  if (!baseUrl.value.trim() || !apiKey.value.trim()) {
    error.value = '请先填写网关地址和 API Key'
    return
  }
  testing.value = true
  try {
    const r = await api.testGateway(baseUrl.value.trim(), apiKey.value.trim())
    models.value = r.models
    testMessage.value = `连接成功,获取到 ${r.models.length} 个模型`
    if (r.models.length && !r.models.includes(selectedModel.value)) {
      selectedModel.value = r.models[0]
    }
  } catch (e: any) {
    error.value = e.message
  } finally {
    testing.value = false
  }
}

async function save() {
  const model = (selectedModel.value === '__custom__' ? customModel.value : selectedModel.value).trim()
  if (!model) {
    error.value = '请选择或填写模型名'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const s = await api.updateSettings({
      model,
      llmBaseUrl: baseUrl.value.trim(),
      llmApiKey: apiKey.value.trim(),
    })
    emit('saved', s.model)
    emit('close')
  } catch (e: any) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <h3>大模型网关设置</h3>
      <p class="sub">用于「AI 实时解读」和高危命令确认框里的语义解释。填入你自己的网关地址和 Key,支持随时切换。</p>

      <template v-if="loading">
        <p class="dim">加载中…</p>
      </template>
      <template v-else>
        <label>网关地址(OpenAI 兼容,如 https://xxx.com)</label>
        <input v-model="baseUrl" placeholder="https://llm.example.com" />

        <label>API Key</label>
        <div class="key-row">
          <input v-model="apiKey" :type="showApiKey ? 'text' : 'password'" placeholder="sk_xxxxxxxx" />
          <button class="eye-btn" type="button" @click="showApiKey = !showApiKey">
            {{ showApiKey ? '🙈' : '👁' }}
          </button>
        </div>

        <div class="test-row">
          <button class="btn ghost" :disabled="testing" @click="testConnection">
            {{ testing ? '测试中…' : '测试连接并获取模型列表' }}
          </button>
          <span v-if="testMessage" class="ok-msg">{{ testMessage }}</span>
        </div>

        <label>当前使用模型</label>
        <div class="current">{{ currentModel || '(未设置)' }}</div>

        <label>选择模型</label>
        <select v-model="selectedModel">
          <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
          <option value="__custom__">自定义…</option>
        </select>
        <input
          v-if="selectedModel === '__custom__'"
          v-model="customModel"
          placeholder="手动输入网关支持的模型 id"
          style="margin-top: 8px"
        />

        <p v-if="!llmEnabled" class="hint">当前网关未配置完整(地址或 Key 缺失),AI 解读功能不可用。</p>
        <p v-if="error" class="err">{{ error }}</p>

        <div class="actions">
          <button class="btn ghost" @click="emit('close')">取消</button>
          <button class="btn" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  width: 440px;
  max-height: 90vh;
  overflow-y: auto;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 22px;
}
h3 {
  margin: 0 0 6px;
}
.sub {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.5;
}
label {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
  margin: 12px 0 4px;
}
.key-row {
  display: flex;
  gap: 6px;
}
.key-row input {
  flex: 1;
  font-family: monospace;
}
.eye-btn {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  width: 36px;
  flex: none;
  font-size: 14px;
}
.eye-btn:hover {
  border-color: var(--accent);
}
.test-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.ok-msg {
  font-size: 12px;
  color: var(--safe);
}
.current {
  font-family: monospace;
  font-size: 13px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--accent);
}
.hint {
  color: var(--caution);
  font-size: 12px;
  margin-top: 12px;
}
.err {
  color: var(--danger);
  font-size: 12px;
  margin-top: 10px;
}
.dim {
  color: var(--text-dim);
  font-size: 13px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
</style>
