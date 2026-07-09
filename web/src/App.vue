<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { api, getToken, clearToken, type Host, type AnalyzeResult } from './api'
import LoginView from './components/LoginView.vue'
import HostList from './components/HostList.vue'
import TerminalView from './components/TerminalView.vue'
import AnalysisPanel from './components/AnalysisPanel.vue'
import AuditLogView from './components/AuditLogView.vue'
import SettingsModal from './components/SettingsModal.vue'
import FileManagerView from './components/FileManagerView.vue'
import CommandHintBar from './components/CommandHintBar.vue'
import SuperTerminalView from './components/SuperTerminalView.vue'
import SnippetsBar from './components/SnippetsBar.vue'
import HostStatusBadge from './components/HostStatusBadge.vue'
import TerminalSettingsModal from './components/TerminalSettingsModal.vue'

// 终端外观设置:用 localStorage 持久化,刷新页面后依然保留
const TERM_SETTINGS_KEY = 'ssh_web_term_settings'
interface TermSettings {
  fontSize: number
  fontFamily: string
  lineHeight: number
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
}
const DEFAULT_TERM_SETTINGS: TermSettings = {
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
  lineHeight: 1,
  cursorStyle: 'block',
  cursorBlink: true,
}
function loadTermSettings(): TermSettings {
  try {
    const s = JSON.parse(localStorage.getItem(TERM_SETTINGS_KEY) || '')
    return { ...DEFAULT_TERM_SETTINGS, ...s }
  } catch {
    return { ...DEFAULT_TERM_SETTINGS }
  }
}
function persistTermSettings(s: TermSettings) {
  localStorage.setItem(TERM_SETTINGS_KEY, JSON.stringify(s))
}
const termSettings = ref<TermSettings>(loadTermSettings())

// 命令解读面板的高度(可拖拽分隔条调整),也存 localStorage 持久化
const PANEL_HEIGHT_KEY = 'ssh_web_panel_height'
const DEFAULT_PANEL_HEIGHT = 170
const panelHeight = ref(Number(localStorage.getItem(PANEL_HEIGHT_KEY)) || DEFAULT_PANEL_HEIGHT)
let resizeStartHeight = 0
let resizeRaf: number | null = null
let pendingDelta = 0
function onPanelResizeStart() {
  resizeStartHeight = panelHeight.value
}
function onPanelResize(delta: number) {
  // delta>0 表示鼠标下移 => 面板变矮(高度减小);最小保留 40px(折叠态高度),最大不超过窗口-200(给终端留至少 200px)
  pendingDelta = delta
  // 用 requestAnimationFrame 节流:鼠标移动事件触发频率很高(每秒上百次),
  // 直接每次都更新 Vue 响应式状态 + 触发 DOM 重排会掉帧卡顿;合并到每帧只更新一次就顺了
  if (resizeRaf !== null) return
  resizeRaf = window.requestAnimationFrame(() => {
    resizeRaf = null
    const next = resizeStartHeight + pendingDelta
    panelHeight.value = Math.max(40, Math.min(next, window.innerHeight - 200))
    // 拖拽过程中实时让终端 fit,这样鼠标动到哪里终端尺寸就跟到哪里,不会等松手才一次跳变
    for (const ref of terminalRefs.values()) (ref as any)?.refit?.()
  })
}
function onPanelResizeEnd() {
  if (resizeRaf !== null) {
    window.cancelAnimationFrame(resizeRaf)
    resizeRaf = null
  }
  localStorage.setItem(PANEL_HEIGHT_KEY, String(panelHeight.value))
  nextTick(() => {
    for (const ref of terminalRefs.values()) (ref as any)?.refit?.()
  })
}

interface Session {
  id: string // 每个会话独立的唯一 id(不等于 hostId,允许同一台主机开多个会话)
  hostId: string
  host: Host
  hostView: 'terminal' | 'files'
  superTerminal: boolean
  analysis: { command: string; result: AnalyzeResult | null; loading: boolean }
}

const logged = ref(Boolean(getToken()))
const llmEnabled = ref(false)
const currentModel = ref('')
const tab = ref<'terminal' | 'audit'>('terminal')
const showSettings = ref(false)
const showTermSettings = ref(false)

// 桌面客户端(Electron)里标题栏被隐藏、由本页顶栏充当:据此把顶栏设为可拖拽区域,
// 并让出 mac 红绿灯(左)/ win 窗口控件(右)的位置,避免和品牌名、按钮重叠。
const isElectron = navigator.userAgent.includes('Electron')
const isMac = navigator.userAgent.includes('Mac')

// 多会话:每台已连接的主机对应一个 session,后台标签保持 WebSocket 连接不断开
const sessions = ref<Session[]>([])
const activeSessionId = ref<string | null>(null)
const activeSession = computed(() => sessions.value.find((s) => s.id === activeSessionId.value) || null)
const terminalRefs = new Map<string, InstanceType<typeof TerminalView>>()

const aiRealtime = ref(true)
const blockDanger = ref(true)
const snippetsBar = ref(false) // 全局开关:勾选后所有终端会话都显示快捷命令栏

async function loadConfig() {
  try {
    const c = await api.config()
    llmEnabled.value = c.llmEnabled
    currentModel.value = c.model
    if (!c.llmEnabled) aiRealtime.value = false
  } catch {
    /* 未登录时忽略 */
  }
}

onMounted(() => {
  if (logged.value) loadConfig()
  // 浏览器窗口大小变化时(拖动浏览器边框、最大化/还原),终端可见区域尺寸变了,
  // 要让所有已连接的终端重新 fit 一次,并把新的行列数同步给远端 shell,否则输出排版会错位
  let winResizeRaf: number | null = null
  const onWinResize = () => {
    if (winResizeRaf !== null) return
    winResizeRaf = window.requestAnimationFrame(() => {
      winResizeRaf = null
      for (const ref of terminalRefs.values()) (ref as any)?.refit?.()
    })
  }
  window.addEventListener('resize', onWinResize)
  ;(window as any).__termWinResizeHandler = onWinResize
})

onBeforeUnmount(() => {
  const h = (window as any).__termWinResizeHandler
  if (h) window.removeEventListener('resize', h)
})

function onLoginSuccess() {
  logged.value = true
  loadConfig()
}
function logout() {
  // 退出登录时把所有已连接会话一并关闭,避免留下孤立的后台 SSH 连接
  sessions.value = []
  activeSessionId.value = null
  clearToken()
  logged.value = false
}

function openSession(h: Host) {
  const existing = sessions.value.find((s) => s.hostId === h.id)
  if (existing) {
    existing.host = h
    activeSessionId.value = existing.id
  } else {
    const id = crypto.randomUUID()
    sessions.value.push({
      id,
      hostId: h.id,
      host: h,
      hostView: 'terminal',
      superTerminal: false,
      analysis: { command: '', result: null, loading: false },
    })
    activeSessionId.value = id
  }
  tab.value = 'terminal'
}

// 给同一台主机再开一个独立的新会话(复制标签),不影响原有会话
function duplicateSession(sessionId: string) {
  const src = sessions.value.find((s) => s.id === sessionId)
  if (!src) return
  const id = crypto.randomUUID()
  sessions.value.push({
    id,
    hostId: src.hostId,
    host: src.host,
    hostView: 'terminal',
    superTerminal: false,
    analysis: { command: '', result: null, loading: false },
  })
  activeSessionId.value = id
}

// 同一台主机开了多个会话时,标签上加个序号区分
function sessionLabel(s: Session): string {
  const sameHost = sessions.value.filter((x) => x.hostId === s.hostId)
  if (sameHost.length <= 1) return s.host.label || s.host.host
  const idx = sameHost.indexOf(s) + 1
  return `${s.host.label || s.host.host} #${idx}`
}

function closeSession(id: string) {
  const idx = sessions.value.findIndex((s) => s.id === id)
  if (idx < 0) return
  sessions.value.splice(idx, 1)
  terminalRefs.delete(id)
  if (activeSessionId.value === id) {
    const next = sessions.value[idx] ?? sessions.value[idx - 1]
    activeSessionId.value = next ? next.id : null
  }
}

function onHostUpdated(h: Host) {
  for (const s of sessions.value) {
    if (s.hostId === h.id) s.host = h
  }
}
function onHostRemoved(hostId: string) {
  // 该主机可能被复制开了不止一个会话,一并关闭
  const ids = sessions.value.filter((s) => s.hostId === hostId).map((s) => s.id)
  for (const id of ids) closeSession(id)
}

function onModelSaved(model: string) {
  currentModel.value = model
  // 重新拉取配置,刷新 llmEnabled——否则刚配好网关时「AI 实时解读」仍是禁用态(网关未配置),
  // 要重开 App 才生效。这里保存后立即同步,勾选框马上可用。
  loadConfig()
}
function updateTermSetting<K extends keyof TermSettings>(key: K, value: TermSettings[K]) {
  termSettings.value = { ...termSettings.value, [key]: value }
  persistTermSettings(termSettings.value)
}
function resetTermSettings() {
  termSettings.value = { ...DEFAULT_TERM_SETTINGS }
  persistTermSettings(termSettings.value)
}
function setTerminalRef(id: string, el: unknown) {
  if (el) terminalRefs.set(id, el as InstanceType<typeof TerminalView>)
  else terminalRefs.delete(id)
}
function onInsertCommand(sessionId: string, command: string) {
  terminalRefs.get(sessionId)?.insertText(command)
}
function onApplySuggestion(sessionId: string, command: string) {
  terminalRefs.get(sessionId)?.replaceCurrentLine(command)
}
function onRunSnippet(sessionId: string, command: string) {
  // 点快捷命令按钮:把命令插入当前行(不自动回车,走正常的本地/AI 解读和高危拦截流程)
  terminalRefs.get(sessionId)?.insertText(command)
}
</script>

<template>
  <LoginView v-if="!logged" @success="onLoginSuccess" />
  <div v-else class="app">
    <div class="topbar" :class="{ electron: isElectron, mac: isMac }">
      <span class="brand">X terminal</span>
      <div class="tabs">
        <button class="tab" :class="{ active: tab === 'terminal' }" @click="tab = 'terminal'">终端</button>
        <button class="tab" :class="{ active: tab === 'audit' }" @click="tab = 'audit'">审计日志</button>
      </div>
      <div class="right">
        <button
          class="model-badge"
          :title="llmEnabled ? '当前命令分析模型: ' + currentModel + '(点击设置大模型)' : '点击设置大模型网关 / 模型'"
          @click="showSettings = true"
        >
          {{ llmEnabled ? '模型:' + currentModel : '⚙ 大模型设置' }}
        </button>
        <button class="icon-btn" title="终端外观设置" @click="showTermSettings = true">Aa</button>
      </div>
    </div>

    <div class="body">
      <div v-show="tab === 'terminal'" class="layout">
        <div class="col-hosts">
          <HostList
            :active-id="activeSession?.hostId ?? null"
            :open-ids="sessions.map((s) => s.hostId)"
            @connect="openSession"
            @logout="logout"
            @update="onHostUpdated"
            @removed="onHostRemoved"
          />
        </div>
        <div class="col-main">
          <div v-if="sessions.length" class="session-tabs">
            <div
              v-for="s in sessions"
              :key="s.id"
              class="session-tab"
              :class="{ active: s.id === activeSessionId }"
              @click="activeSessionId = s.id"
            >
              <span class="session-tab-label">{{ sessionLabel(s) }}</span>
              <button class="session-tab-dup" title="复制标签(同一台主机再开一个会话)" @click.stop="duplicateSession(s.id)">
                ⧉
              </button>
              <button class="session-tab-close" title="关闭连接" @click.stop="closeSession(s.id)">×</button>
            </div>
          </div>

          <div v-if="activeSession" class="host-subtabs">
            <button
              class="subtab"
              :class="{ active: activeSession.hostView === 'terminal' }"
              @click="activeSession.hostView = 'terminal'"
            >
              终端
            </button>
            <button
              class="subtab"
              :class="{ active: activeSession.hostView === 'files' }"
              @click="activeSession.hostView = 'files'"
            >
              文件传输
            </button>
            <HostStatusBadge :host="activeSession.host" />
            <button
              v-if="activeSession.hostView === 'terminal'"
              class="subtab super-toggle"
              :class="{ active: activeSession.superTerminal }"
              @click="activeSession.superTerminal = !activeSession.superTerminal"
            >
              <svg class="sparkle-icon" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L13.8 9.2L21 11L13.8 12.8L12 20L10.2 12.8L3 11L10.2 9.2L12 2Z"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linejoin="round"
                />
              </svg>
              超级终端
            </button>
          </div>

          <div class="main-content">
            <div v-if="!sessions.length" class="empty-workspace">
              从左侧选择一台主机开始连接,支持同时连接多台,每台主机独立保持会话。
            </div>
            <template v-for="s in sessions" :key="s.id">
              <div v-show="s.id === activeSessionId" class="session-content">
                <div v-show="s.hostView === 'terminal'" class="term-and-panel">
                  <div class="term-area" :class="{ 'super-active': s.superTerminal }">
                    <TerminalView
                      :ref="(el) => setTerminalRef(s.id, el)"
                      :host="s.host"
                      :ai-realtime="aiRealtime"
                      :block-danger="blockDanger"
                      :visible="s.id === activeSessionId"
                      :font-size="termSettings.fontSize"
                      :font-family="termSettings.fontFamily"
                      :line-height="termSettings.lineHeight"
                      :cursor-style="termSettings.cursorStyle"
                      :cursor-blink="termSettings.cursorBlink"
                      @analysis="s.analysis = $event"
                    />
                  </div>
                  <SnippetsBar
                    v-if="snippetsBar"
                    @run="(cmd) => onRunSnippet(s.id, cmd)"
                  />
                  <CommandHintBar :hint="s.analysis.result?.hint ?? null" />
                  <SuperTerminalView
                    v-if="s.superTerminal"
                    :llm-enabled="llmEnabled"
                    @insert="(cmd) => onInsertCommand(s.id, cmd)"
                  />
                  <AnalysisPanel
                    :command="s.analysis.command"
                    :result="s.analysis.result"
                    :loading="s.analysis.loading"
                    :llm-enabled="llmEnabled"
                    :panel-height="panelHeight"
                    v-model:ai-realtime="aiRealtime"
                    v-model:block-danger="blockDanger"
                    v-model:snippets-bar="snippetsBar"
                    @apply-suggestion="(cmd) => onApplySuggestion(s.id, cmd)"
                    @resize-start="onPanelResizeStart"
                    @resize="onPanelResize"
                    @resize-end="onPanelResizeEnd"
                  />
                </div>
                <FileManagerView v-if="s.hostView === 'files'" :host="s.host" />
              </div>
            </template>
          </div>
        </div>
      </div>
      <AuditLogView v-if="tab === 'audit'" />
    </div>

    <SettingsModal v-if="showSettings" @close="showSettings = false" @saved="onModelSaved" />
    <TerminalSettingsModal
      v-if="showTermSettings"
      :font-size="termSettings.fontSize"
      :font-family="termSettings.fontFamily"
      :line-height="termSettings.lineHeight"
      :cursor-style="termSettings.cursorStyle"
      :cursor-blink="termSettings.cursorBlink"
      @update:font-size="(v) => updateTermSetting('fontSize', v)"
      @update:font-family="(v) => updateTermSetting('fontFamily', v)"
      @update:line-height="(v) => updateTermSetting('lineHeight', v)"
      @update:cursor-style="(v) => updateTermSetting('cursorStyle', v)"
      @update:cursor-blink="(v) => updateTermSetting('cursorBlink', v)"
      @reset="resetTermSettings"
      @close="showTermSettings = false"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 16px;
  height: 46px;
  flex: none;
  border-bottom: 1px solid var(--border);
  background: var(--bg-soft);
}
/* Electron:顶栏充当标题栏,整条可拖拽移动窗口;内部按钮/徽章需排除拖拽以便点击 */
.topbar.electron {
  -webkit-app-region: drag;
}
.topbar.electron button,
.topbar.electron .model-badge,
.topbar.electron .tab {
  -webkit-app-region: no-drag;
}
/* mac 红绿灯在左上,让出空间;win 窗口控件在右上,让出空间 */
.topbar.electron.mac {
  padding-left: 82px;
}
.topbar.electron:not(.mac) {
  padding-right: 150px;
}
.brand {
  font-weight: 600;
  font-size: 13px;
}
.tabs {
  display: flex;
  gap: 4px;
}
.tab {
  background: transparent;
  border: none;
  color: var(--text-dim);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  background: var(--bg-panel);
  color: var(--text);
}
.right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.model-badge {
  font-size: 12px;
  color: var(--text-dim);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px 12px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.model-badge:hover {
  color: var(--text);
  border-color: var(--accent);
}
.icon-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 6px;
  width: 28px;
  height: 28px;
}
.icon-btn:hover {
  color: var(--text);
}
.body {
  flex: 1;
  min-height: 0;
}
.layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  height: 100%;
}
.col-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.session-tabs {
  display: flex;
  gap: 4px;
  padding: 6px 10px 0;
  background: var(--bg-soft);
  flex: none;
  overflow-x: auto;
}
.session-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px 12px;
  border-radius: 8px 8px 0 0;
  background: var(--bg);
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--border);
  border-bottom: none;
  white-space: nowrap;
  flex: none;
}
.session-tab.active {
  background: var(--bg-panel);
  color: var(--text);
}
.session-tab-close {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
}
.session-tab-close:hover {
  color: var(--danger);
  background: rgba(248, 81, 73, 0.12);
}
.session-tab-dup {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
}
.session-tab-dup:hover {
  color: var(--accent);
  background: rgba(79, 140, 255, 0.12);
}
.host-subtabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-soft);
  flex: none;
}
.subtab {
  background: transparent;
  border: none;
  color: var(--text-dim);
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
}
.subtab:hover {
  color: var(--text);
}
.subtab.active {
  background: var(--bg-panel);
  color: var(--text);
}
.super-toggle {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.super-toggle.active {
  background: rgba(79, 140, 255, 0.18);
  color: var(--accent);
}
.sparkle-icon {
  width: 13px;
  height: 13px;
  flex: none;
}
.main-content {
  flex: 1;
  min-height: 0;
  position: relative;
}
.empty-workspace {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 13px;
  padding: 0 40px;
  text-align: center;
}
.session-content {
  height: 100%;
}
.term-and-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden; /* 防止内部终端内容(字号变大后)把容器撑高 */
}
.term-area {
  flex: 1 1 0;
  min-height: 0;
  box-sizing: border-box;
  border: 1px solid transparent;
  overflow: hidden;
}
.term-area :deep(.term-wrap) {
  height: 100%;
  overflow: hidden;
}
.term-area.super-active {
  border-color: rgba(79, 140, 255, 0.55);
}
</style>
