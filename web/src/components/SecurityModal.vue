<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, type SecurityMode } from '../api'

const emit = defineEmits<{ (e: 'close'): void }>()

const mode = ref<SecurityMode>('password')
const loading = ref(true)
const error = ref('')
const success = ref('')

// 改密码
const oldPw = ref('')
const newPw = ref('')
const newPw2 = ref('')

// 关闭密码验证(需当前密码)
const disablePw = ref('')
// 开启密码验证(需新密码)
const enablePw = ref('')
const enablePw2 = ref('')

async function refresh() {
  loading.value = true
  try {
    const s = await api.securityStatus()
    mode.value = s.mode
  } catch (e: any) {
    error.value = e.message || '加载安全状态失败'
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

function reset() {
  error.value = ''
  success.value = ''
}

async function doChangePassword() {
  reset()
  if (newPw.value.length < 4) return (error.value = '新密码至少 4 位')
  if (newPw.value !== newPw2.value) return (error.value = '两次输入的新密码不一致')
  try {
    await api.changePassword(oldPw.value, newPw.value)
    success.value = '密码已修改'
    oldPw.value = newPw.value = newPw2.value = ''
  } catch (e: any) {
    error.value = e.message || '修改失败'
  }
}

async function doDisable() {
  reset()
  try {
    await api.setSecurityMode(false, { password: disablePw.value })
    success.value = '已关闭密码验证,下次打开将免密进入'
    disablePw.value = ''
    await refresh()
  } catch (e: any) {
    error.value = e.message || '操作失败'
  }
}

async function doEnable() {
  reset()
  if (enablePw.value.length < 4) return (error.value = '密码至少 4 位')
  if (enablePw.value !== enablePw2.value) return (error.value = '两次输入的密码不一致')
  try {
    await api.setSecurityMode(true, { newPassword: enablePw.value })
    success.value = '已开启密码验证'
    enablePw.value = enablePw2.value = ''
    await refresh()
  } catch (e: any) {
    error.value = e.message || '操作失败'
  }
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <h3>安全设置</h3>
      <p v-if="loading" class="sub">加载中…</p>

      <template v-else>
        <p class="sub">
          当前模式:<strong>{{ mode === 'password' ? '密码验证' : '免密(本机直接打开)' }}</strong>
        </p>

        <!-- 密码模式:改密码 + 关闭密码验证 -->
        <template v-if="mode === 'password'">
          <div class="section">
            <div class="section-title">修改访问密码</div>
            <input v-model="oldPw" type="password" placeholder="当前密码" />
            <input v-model="newPw" type="password" placeholder="新密码(至少 4 位)" />
            <input v-model="newPw2" type="password" placeholder="再次输入新密码" />
            <button class="btn" @click="doChangePassword">保存新密码</button>
          </div>

          <div class="section">
            <div class="section-title">关闭密码验证</div>
            <p class="hint">关闭后,本机任何人打开应用即可直接进入(凭据仍加密存储)。</p>
            <input v-model="disablePw" type="password" placeholder="输入当前密码以确认" />
            <button class="btn ghost" @click="doDisable">关闭密码验证</button>
          </div>
        </template>

        <!-- 免密模式:开启密码验证 -->
        <template v-else>
          <div class="section">
            <div class="section-title">开启密码验证</div>
            <p class="hint">开启后,每次打开应用需要输入密码。</p>
            <input v-model="enablePw" type="password" placeholder="设置密码(至少 4 位)" />
            <input v-model="enablePw2" type="password" placeholder="再次输入密码" />
            <button class="btn" @click="doEnable">开启密码验证</button>
          </div>
        </template>

        <p v-if="error" class="err">{{ error }}</p>
        <p v-if="success" class="ok">{{ success }}</p>
      </template>

      <div class="modal-actions">
        <button class="btn ghost" @click="emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
.sub {
  color: var(--text-dim);
  font-size: 13px;
  margin: 0 0 12px;
}
.sub strong {
  color: var(--text);
}
.section {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.section-title {
  font-weight: 600;
  font-size: 13px;
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}
.err {
  color: var(--danger);
  font-size: 12px;
  margin: 0 0 6px;
}
.ok {
  color: var(--safe);
  font-size: 12px;
  margin: 0 0 6px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}
</style>
