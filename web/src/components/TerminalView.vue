<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, reactive, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { api, getToken, type Host, type AnalyzeResult } from '../api'
import RiskConfirmModal from './RiskConfirmModal.vue'

const props = defineProps<{
  host: Host | null
  aiRealtime: boolean
  blockDanger: boolean
  /** 当前是否处于可见的会话标签(多会话场景下,后台标签仍保持连接但不显示) */
  visible?: boolean
  fontSize?: number
  fontFamily?: string
  lineHeight?: number
  cursorStyle?: 'block' | 'underline' | 'bar'
  cursorBlink?: boolean
}>()
const emit = defineEmits<{
  (e: 'analysis', payload: { command: string; result: AnalyzeResult | null; loading: boolean }): void
}>()

const termEl = ref<HTMLDivElement | null>(null)
let term: Terminal | null = null
let fit: FitAddon | null = null
let ws: WebSocket | null = null
let ro: ResizeObserver | null = null

let lineBuffer = ''
let analyzeTimer: number | null = null
let disconnected = false // 连接已断开(等待用户回车重连)

// ---- 用于修正"远端自己改写当前行"的场景(Tab 补全、方向键翻历史命令) ----
// 本地按键拼接 lineBuffer 对普通打字够用,但补全/翻历史是远端 shell 决定内容并回显给我们,
// 不是我们敲的键,所以这类场景改成直接从 xterm 的屏幕缓冲区里读回真实回显内容。
let lineStartRow: number | null = null // 当前命令起始位置的绝对行号(提示符结束处)
let lineStartCol: number | null = null // 当前命令起始位置的列号
let resyncTimer: number | null = null

// 记录"这一行命令从哪里开始":只在 lineBuffer 从空变为非空的那一刻记录当前光标位置即可——
// 那一刻光标必然正好停在提示符后面(因为在这之前没有任何本地输入改动过这一行)。
// 之前用过"等远端输出安静下来再记录"的方案,但连接横幅/MOTD 还没走完时用户就开始打字的话,
// 每个按键的回显都会重新计时,导致真正记录到的位置被拖到命令中间甚至末尾,补全后读出来是空的。
// 直接跟着本地 lineBuffer 的状态走,不依赖任何计时器,就没有这个竞态问题。
function markLineStartIfNeeded() {
  if (lineBuffer !== '' || !term) return
  const buf = term.buffer.active
  lineStartRow = buf.baseY + buf.cursorY
  lineStartCol = buf.cursorX
}

// Tab 补全 / 方向键翻历史:发送按键给远端后,等它回显完成,直接从屏幕上读出这一行的真实内容。
// 只读到光标当前位置为止(而不是整行到底)——像 zsh-autosuggestions / fish 这类带"灰色建议文字"的
// shell,光标后面显示的是还没被接受的建议,并不是真的会执行的内容,读多了会把建议文字也当成命令。
function scheduleResync() {
  if (resyncTimer) clearTimeout(resyncTimer)
  resyncTimer = window.setTimeout(() => {
    if (!term || lineStartRow === null || lineStartCol === null) return
    const buf = term.buffer.active
    const line = buf.getLine(lineStartRow)
    if (!line) return
    const cursorAbsRow = buf.baseY + buf.cursorY
    const endCol = cursorAbsRow === lineStartRow ? buf.cursorX : line.length
    lineBuffer = line.translateToString(true, lineStartCol, Math.max(endCol, lineStartCol))
    scheduleAnalyze()
  }, 150)
}

// ---- 连接建立后隐藏远端登录横幅(MOTD) ----
// 横幅内容因系统而异、没有固定格式,没法可靠地"识别横幅在哪结束",干脆刚连上时先缓冲远端输出、
// 不直接写入终端,等输出安静下来(短暂无新数据)或超过硬顶格时长后再放行——但不能简单地整段丢弃:
// 真正的 shell 提示符很可能就在这段缓冲区的最后(横幅每一行都会换行,只有等待输入的提示符那一行不换行),
// 所以放行时只保留"最后一个换行符之后剩下的内容"(也就是提示符本身),前面的横幅文本才是真正要丢弃的部分。
let suppressingBanner = false
let bannerBuffer = ''
let bannerQuietTimer: number | null = null
let bannerHardTimer: number | null = null

function startBannerSuppression() {
  suppressingBanner = true
  bannerBuffer = ''
  if (bannerHardTimer) clearTimeout(bannerHardTimer)
  bannerHardTimer = window.setTimeout(flushBannerSuppression, 3000) // 硬顶格,避免异常情况下一直不放行
}
function flushBannerSuppression() {
  if (!suppressingBanner) return
  suppressingBanner = false
  if (bannerQuietTimer) clearTimeout(bannerQuietTimer)
  bannerQuietTimer = null
  if (bannerHardTimer) clearTimeout(bannerHardTimer)
  bannerHardTimer = null
  const idx = bannerBuffer.lastIndexOf('\n')
  const remainder = idx >= 0 ? bannerBuffer.slice(idx + 1) : bannerBuffer
  if (remainder) term?.write(remainder)
  bannerBuffer = ''
}
// 出错时直接取消抑制,不把缓冲的横幅内容写出来(避免和错误提示混在一起,显得乱)
function cancelBannerSuppression() {
  suppressingBanner = false
  if (bannerQuietTimer) clearTimeout(bannerQuietTimer)
  bannerQuietTimer = null
  if (bannerHardTimer) clearTimeout(bannerHardTimer)
  bannerHardTimer = null
  bannerBuffer = ''
}

// 高危确认弹窗状态
const confirmState = reactive<{
  open: boolean
  command: string
  result: AnalyzeResult | null
  llmLoading: boolean
}>({ open: false, command: '', result: null, llmLoading: false })

function wsSend(msg: object) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function connect(host: Host) {
  cleanup()
  term = new Terminal({
    cursorBlink: props.cursorBlink ?? true,
    cursorStyle: props.cursorStyle ?? 'block',
    fontSize: props.fontSize ?? 14,
    fontFamily: props.fontFamily || 'Menlo, Monaco, Consolas, "Courier New", monospace',
    lineHeight: props.lineHeight ?? 1,
    theme: { background: '#0f1115', foreground: '#d7dae0' },
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon())
  term.open(termEl.value!)
  fit.fit()
  term.focus()

  startBannerSuppression() // 刚连上时先不显示远端输出,等它安静下来再放行,借此隐藏登录横幅(MOTD)

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws/ssh`)

  ws.onopen = () => {
    disconnected = false
    wsSend({
      type: 'auth',
      token: getToken(),
      hostId: host.id,
      cols: term!.cols,
      rows: term!.rows,
    })
  }
  ws.onmessage = (ev) => {
    let msg: any
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    if (msg.type === 'data') {
      if (suppressingBanner) {
        bannerBuffer += msg.data
        if (bannerQuietTimer) clearTimeout(bannerQuietTimer)
        bannerQuietTimer = window.setTimeout(flushBannerSuppression, 300)
        return // 抑制期内先缓冲(登录横幅/MOTD),放行时只保留最后一行提示符
      }
      term?.write(msg.data)
    } else if (msg.type === 'status') {
      // "已连接 xxx" 只是我们自己加的提示,意义不大(马上就能看到 shell 提示符了),不打印;
      // 其他状态(比如会话结束)仍然提示
      if (!msg.message.startsWith('已连接')) term?.writeln(`\x1b[90m${msg.message}\x1b[0m`)
    } else if (msg.type === 'error') {
      cancelBannerSuppression() // 出错信息必须让用户看到,不能被横幅抑制吞掉
      term?.writeln(`\r\n\x1b[31m${msg.message}\x1b[0m`)
    }
  }
  ws.onclose = () => {
    disconnected = true
    term?.writeln('\r\n\x1b[90m[连接已关闭,按回车重新连接]\x1b[0m')
  }

  term.onData(handleInput)
  term.onResize(({ cols, rows }) => wsSend({ type: 'resize', cols, rows }))

  ro = new ResizeObserver(() => fit?.fit())
  ro.observe(termEl.value!)
}

function handleInput(d: string) {
  // 连接已断开:回车触发重连(重建终端与 WebSocket),其他按键忽略,避免把无效输入塞进缓冲
  if (disconnected) {
    if (d === '\r' && props.host) {
      const h = props.host
      setTimeout(() => connect(h), 0) // 延到回调外再重建,避免在 onData 回调里 dispose 当前终端
    }
    return
  }
  // 回车:先做风险判断再决定是否放行
  if (d === '\r') {
    onEnter()
    return
  }
  // Tab 补全 / 方向键翻历史:内容由远端决定,发送后等回显、直接从屏幕读回真实内容
  if (d === '\t' || d === '\x1b[A' || d === '\x1b[B') {
    markLineStartIfNeeded() // 如果这是当前这一行的第一次按键,先记好起点
    wsSend({ type: 'data', data: d })
    scheduleResync()
    return
  }
  // 多字符(粘贴)或含换行:直接透传并重置缓冲,不做逐行拦截
  if (d.length > 1 || d.includes('\n')) {
    markLineStartIfNeeded()
    lineBuffer = d.includes('\n') ? '' : lineBuffer + d
    wsSend({ type: 'data', data: d })
    scheduleAnalyze()
    return
  }
  markLineStartIfNeeded()
  const code = d.charCodeAt(0)
  if (d === '\x7f' || d === '\b') {
    lineBuffer = lineBuffer.slice(0, -1) // 退格
  } else if (d === '\x03') {
    lineBuffer = '' // Ctrl-C:放弃当前行
  } else if (d === '\x15' || code === 0x1b) {
    lineBuffer = '' // Ctrl-U / 其他 ESC 起始的控制序列,重置行缓冲
  } else if (code >= 0x20) {
    lineBuffer += d // 可打印字符
  }
  wsSend({ type: 'data', data: d })
  scheduleAnalyze()
}

async function onEnter() {
  const cmd = lineBuffer.trim()
  lineBuffer = ''
  emit('analysis', { command: '', result: null, loading: false })

  if (!cmd) {
    wsSend({ type: 'data', data: '\r' })
    return
  }

  // 先做一次快速本地风险判断(不调用大模型),用于决定是否拦截 + 写入审计日志
  let quick: AnalyzeResult | null = null
  try {
    quick = await api.analyze(cmd, false)
  } catch {
    // 分析失败则放行,避免影响正常操作;不记录审计(无法判断风险)
    wsSend({ type: 'data', data: '\r' })
    return
  }

  if (props.blockDanger && quick.local.level === 'danger') {
    // 拦截:弹确认框,同时异步取 AI 详细解读
    confirmState.open = true
    confirmState.command = cmd
    confirmState.result = quick
    confirmState.llmLoading = true
    try {
      const full = await api.analyze(cmd, true)
      confirmState.result = full
    } catch {
      /* 保留本地结果 */
    } finally {
      confirmState.llmLoading = false
    }
    return // 是否执行由用户在确认框中决定(见 confirmExec / cancelExec)
  }

  wsSend({ type: 'data', data: '\r' })
  logAudit(cmd, quick, true)
}

function logAudit(command: string, result: AnalyzeResult | null, executed: boolean) {
  if (!props.host || !result) return
  api
    .logAudit({
      hostId: props.host.id,
      hostLabel: props.host.label || props.host.host,
      command,
      level: result.level,
      executed,
      ruleTitles: result.local.matched.map((m) => m.title),
      llmSummary: result.llm?.summary,
    })
    .catch(() => {
      /* 审计写入失败不影响终端使用 */
    })
}

function confirmExec() {
  confirmState.open = false
  wsSend({ type: 'data', data: '\r' }) // 放行回车,执行命令
  logAudit(confirmState.command, confirmState.result, true)
  emit('analysis', { command: '', result: null, loading: false })
  term?.focus()
}
function cancelExec() {
  confirmState.open = false
  wsSend({ type: 'data', data: '\x03' }) // Ctrl-C 放弃当前行
  logAudit(confirmState.command, confirmState.result, false)
  emit('analysis', { command: '', result: null, loading: false })
  term?.focus()
}

function scheduleAnalyze() {
  if (analyzeTimer) clearTimeout(analyzeTimer)
  const cmd = lineBuffer.trim()
  if (!cmd) {
    emit('analysis', { command: '', result: null, loading: false })
    return
  }
  emit('analysis', { command: cmd, result: null, loading: true })
  analyzeTimer = window.setTimeout(async () => {
    try {
      const result = await api.analyze(cmd, props.aiRealtime)
      // 仅当仍是当前命令时更新,避免竞态
      if (lineBuffer.trim() === cmd) {
        emit('analysis', { command: cmd, result, loading: false })
      }
    } catch {
      emit('analysis', { command: cmd, result: null, loading: false })
    }
  }, 500)
}

function cleanup() {
  if (analyzeTimer) clearTimeout(analyzeTimer)
  if (resyncTimer) clearTimeout(resyncTimer)
  if (bannerQuietTimer) clearTimeout(bannerQuietTimer)
  if (bannerHardTimer) clearTimeout(bannerHardTimer)
  ro?.disconnect()
  ro = null
  try {
    if (ws) {
      // 先摘掉旧连接的回调,避免关闭旧 ws 时触发的 onclose 把刚重建的会话又标记成"已断开"
      ws.onclose = null
      ws.onmessage = null
      ws.onopen = null
      ws.close()
    }
  } catch {}
  ws = null
  disconnected = false
  term?.dispose()
  term = null
  fit = null
  lineBuffer = ''
  lineStartRow = null
  lineStartCol = null
  suppressingBanner = false
  bannerBuffer = ''
}

watch(
  () => props.host,
  (h) => {
    if (h) connect(h)
    else cleanup()
  },
)

// 组件挂载后(此时模板里的 termEl 已经绑定到真实 DOM 节点)再建立初始连接。
// 不能用 watch 的 immediate:true 代替——那会在 setup() 阶段、DOM 还没挂载前就同步执行 connect(),
// 此时 termEl.value 还是 null,xterm 的 term.open(null) 会直接抛错,导致这个会话整个渲染失败。
onMounted(() => {
  if (props.host) connect(props.host)
})

// 多会话下,本组件实例常驻(切换标签只是 v-show 隐藏),从隐藏切回可见时容器尺寸可能已变化,
// 且隐藏期间 ResizeObserver 不会触发,需要重新 fit 一次
watch(
  () => props.visible,
  (v) => {
    if (v) {
      nextTick(() => {
        fit?.fit()
        term?.focus()
      })
    }
  },
)

// 终端外观设置(字号/字体/行高)可以随时在设置弹窗里改,这里实时应用到已经连接的终端上,不需要重新连接。
// xterm 直接改 term.options.fontSize 不会自动刷新已有的渲染,必须主动 refresh() 重绘整屏;
// 字号/字体/行高会改变每个字符格子的像素尺寸,进而影响一屏能放几行几列,所以改完要重新 fit 一次,
// 并把新的 cols/rows 通过 wsSend 通知远端 shell(否则你看到的行数和远端以为的行数不一致,输出排版会乱)。
watch(
  () => [props.fontSize, props.fontFamily, props.lineHeight],
  () => {
    if (!term) return
    if (props.fontSize) term.options.fontSize = props.fontSize
    if (props.fontFamily) term.options.fontFamily = props.fontFamily
    if (props.lineHeight) term.options.lineHeight = props.lineHeight
    nextTick(() => {
      fit?.fit()
      term?.refresh(0, term.rows - 1)
      if (term) wsSend({ type: 'resize', cols: term.cols, rows: term.rows })
    })
  },
)
watch(
  () => props.cursorStyle,
  (v) => {
    if (term && v) term.options.cursorStyle = v
  },
)
watch(
  () => props.cursorBlink,
  (v) => {
    if (term && v !== undefined) term.options.cursorBlink = v
  },
)

onBeforeUnmount(cleanup)

// 供"超级终端"等外部功能把生成的命令文本插入到当前行(不会自动按回车,复用普通输入的分析/风险流程)
function insertText(text: string) {
  if (!text) return
  handleInput(text)
  term?.focus()
}

// 用退格清空当前已输入的内容,再插入新文本(用于"拼写纠错一键改正")
function replaceCurrentLine(text: string) {
  if (!text) return
  const backspaces = lineBuffer.length
  for (let i = 0; i < backspaces; i++) {
    wsSend({ type: 'data', data: '\x7f' })
  }
  lineBuffer = ''
  handleInput(text)
}

// 拖拽分隔条改变终端容器尺寸后,外部调这个让终端重新 fit 一次 + 把新尺寸通知远端
function refit() {
  if (!term) return
  fit?.fit()
  wsSend({ type: 'resize', cols: term.cols, rows: term.rows })
}

defineExpose({ insertText, replaceCurrentLine, refit })
</script>

<template>
  <div class="term-wrap">
    <div v-if="!host" class="empty">从左侧选择一台主机开始连接。</div>
    <div v-show="host" ref="termEl" class="term"></div>

    <RiskConfirmModal
      v-if="confirmState.open"
      :command="confirmState.command"
      :result="confirmState.result"
      :llm-loading="confirmState.llmLoading"
      @confirm="confirmExec"
      @cancel="cancelExec"
    />
  </div>
</template>

<style scoped>
.term-wrap {
  position: relative;
  height: 100%;
  background: #0f1115;
}
.term {
  height: 100%;
  padding: 6px;
}
.empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
}
</style>
