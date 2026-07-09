<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, setToken, type SecurityMode } from '../api'

const emit = defineEmits<{ (e: 'success'): void }>()

// stage: loading=查询安全状态中; setup=首次设置访问方式; login=密码登录
const stage = ref<'loading' | 'setup' | 'login'>('loading')
const password = ref('')
const error = ref('')
const loading = ref(false)

// 首次设置
const setupMode = ref<SecurityMode>('password')
const setupPassword = ref('')
const setupConfirm = ref('')

onMounted(async () => {
  try {
    const s = await api.securityStatus()
    if (s.needSetup) {
      stage.value = 'setup'
    } else if (s.mode === 'none') {
      // 免密模式:直接换取 token 进入
      await autoLogin()
    } else {
      stage.value = 'login'
    }
  } catch {
    // 查询失败也退回登录页,让用户手动尝试
    stage.value = 'login'
  }
})

async function autoLogin() {
  try {
    const { token } = await api.login('')
    setToken(token)
    emit('success')
  } catch (e: any) {
    error.value = e.message || '进入失败'
    stage.value = 'login'
  }
}

async function submit() {
  error.value = ''
  loading.value = true
  try {
    const { token } = await api.login(password.value)
    setToken(token)
    emit('success')
  } catch (e: any) {
    error.value = e.message || '登录失败'
  } finally {
    loading.value = false
  }
}

async function submitSetup() {
  error.value = ''
  if (setupMode.value === 'password') {
    if (setupPassword.value.length < 4) {
      error.value = '密码至少 4 位'
      return
    }
    if (setupPassword.value !== setupConfirm.value) {
      error.value = '两次输入的密码不一致'
      return
    }
  }
  loading.value = true
  try {
    await api.securityInit(setupMode.value, setupMode.value === 'password' ? setupPassword.value : undefined)
    // 初始化后直接登录进入
    const { token } = await api.login(setupMode.value === 'password' ? setupPassword.value : '')
    setToken(token)
    emit('success')
  } catch (e: any) {
    error.value = e.message || '设置失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <div v-if="stage === 'loading'" class="login-card">
      <h1>X terminal</h1>
      <p class="sub">正在加载…</p>
    </div>

    <!-- 首次运行:设置访问方式 -->
    <form v-else-if="stage === 'setup'" class="login-card" @submit.prevent="submitSetup">
      <h1>X terminal</h1>
      <p class="sub">首次使用,请设置访问方式</p>

      <div class="mode-tabs">
        <button
          type="button"
          class="mode-tab"
          :class="{ active: setupMode === 'password' }"
          @click="setupMode = 'password'"
        >
          设置访问密码
        </button>
        <button
          type="button"
          class="mode-tab"
          :class="{ active: setupMode === 'none' }"
          @click="setupMode = 'none'"
        >
          免密(本机直接打开)
        </button>
      </div>

      <template v-if="setupMode === 'password'">
        <input v-model="setupPassword" type="password" placeholder="设置访问密码(至少 4 位)" autofocus />
        <input v-model="setupConfirm" type="password" placeholder="再次输入密码" />
      </template>
      <p v-else class="hint">免密模式下,本机任何人打开即可使用,凭据仍会加密存储。你之后可以在「安全设置」里开启密码。</p>

      <p v-if="error" class="err">{{ error }}</p>
      <button class="btn" type="submit" :disabled="loading">
        {{ loading ? '设置中…' : '完成设置并进入' }}
      </button>
    </form>

    <!-- 密码登录 -->
    <form v-else class="login-card" @submit.prevent="submit">
      <h1>X terminal</h1>
      <p class="sub">请输入访问密码</p>
      <input v-model="password" type="password" placeholder="访问密码" autofocus />
      <p v-if="error" class="err">{{ error }}</p>
      <button class="btn" type="submit" :disabled="loading || !password">
        {{ loading ? '登录中…' : '登录' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-card {
  width: 320px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
h1 {
  margin: 0;
  font-size: 20px;
}
.sub {
  margin: 0;
  color: var(--text-dim);
  font-size: 13px;
}
.mode-tabs {
  display: flex;
  gap: 6px;
}
.mode-tab {
  flex: 1;
  padding: 8px 6px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
}
.mode-tab.active {
  color: var(--accent);
  border-color: rgba(79, 140, 255, 0.5);
  background: rgba(79, 140, 255, 0.1);
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}
.err {
  color: var(--danger);
  margin: 0;
  font-size: 12px;
}
</style>
