import { COMMAND_DOCS } from './commandDocs.js'
import { NETWORK_DEVICE_DOCS } from './networkDeviceDocs.js'

export interface LocalExplain {
  summary: string
  detail: string
  /** 疑似拼写错误时,给出最可能想输入的正确命令 */
  suggestion?: string
}

// 按未被引号包裹的 | 拆分管道各阶段
function splitPipeline(cmd: string): string[] {
  const parts: string[] = []
  let cur = ''
  let inSingle = false
  let inDouble = false
  for (const ch of cmd) {
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    if (ch === '|' && !inSingle && !inDouble) {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

// 按空白拆分单词,忽略引号内部的空白(引号本身不保留)
function tokenize(seg: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let inSingle = false
  let inDouble = false
  for (const ch of seg) {
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (cur) {
        tokens.push(cur)
        cur = ''
      }
    } else {
      cur += ch
    }
  }
  if (cur) tokens.push(cur)
  return tokens
}

// 收集"值得关注的 token":长选项去掉 =值、短选项拆成单字符(-rf -> -r,-f)、纯位置参数原样保留(如 chmod 的 755)
function collectNotableTokens(rest: string[]): Set<string> {
  const set = new Set<string>()
  for (const t of rest) {
    if (t.startsWith('--')) {
      set.add(t.split('=')[0])
    } else if (t.startsWith('-') && t.length > 1 && !/^-\d+$/.test(t)) {
      set.add(t)
      for (const c of t.slice(1)) set.add(`-${c}`)
    } else {
      set.add(t)
    }
  }
  return set
}

// ---- 网络设备命令(交换机/防火墙/无线控制器等)按"最长前缀短语"匹配,和 Unix 单命令词典分开处理 ----
const NETWORK_PHRASES = NETWORK_DEVICE_DOCS.map((d) => ({
  tokens: d.phrase.toLowerCase().split(/\s+/),
  vendor: d.vendor,
  summary: d.summary,
}))
// 每个短语的第一个词,供拼写纠错候选池使用(比如 dispaly -> display)
const NETWORK_FIRST_WORDS = Array.from(new Set(NETWORK_PHRASES.map((p) => p.tokens[0])))

interface NetworkMatch {
  vendor: string
  summary: string
  matchedLen: number
}

function matchNetworkPhrase(tokens: string[]): NetworkMatch | null {
  const lower = tokens.map((t) => t.toLowerCase())
  let best: NetworkMatch | null = null
  for (const p of NETWORK_PHRASES) {
    if (p.tokens.length > lower.length) continue
    let hit = true
    for (let i = 0; i < p.tokens.length; i++) {
      if (lower[i] !== p.tokens[i]) {
        hit = false
        break
      }
    }
    if (hit && (!best || p.tokens.length > best.matchedLen)) {
      best = { vendor: p.vendor, summary: p.summary, matchedLen: p.tokens.length }
    }
  }
  return best
}

// 给拼写纠错猜出来的词找一句简短说明(Unix 词典优先,找不到再看网络设备词库)
function describeGuess(word: string): string {
  const doc = COMMAND_DOCS[word]
  if (doc) return doc.summary
  const exact = NETWORK_PHRASES.find((p) => p.tokens.length === 1 && p.tokens[0] === word)
  if (exact) return exact.summary
  const partial = NETWORK_PHRASES.find((p) => p.tokens[0] === word)
  return partial ? partial.summary : ''
}


function editDistance(a: string, b: string): number {
  const al = a.length
  const bl = b.length
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0))
  for (let i = 0; i <= al; i++) d[i][0] = i
  for (let j = 0; j <= bl; j++) d[0][j] = j
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1) // 相邻字符换位
      }
    }
  }
  return d[al][bl]
}

const KNOWN_COMMANDS = Array.from(new Set([...Object.keys(COMMAND_DOCS), ...NETWORK_FIRST_WORDS]))

// 在命令知识库里找拼写上最接近的命令名,阈值内才认为是"疑似拼写错误"
function findClosestCommand(word: string): string | null {
  const w = word.toLowerCase()
  if (w.length < 2) return null
  let best: string | null = null
  let bestDist = Infinity
  for (const name of KNOWN_COMMANDS) {
    if (Math.abs(name.length - w.length) > 3) continue // 长度差太大直接跳过,减少无意义比较
    const dist = editDistance(w, name)
    if (dist < bestDist) {
      bestDist = dist
      best = name
    }
  }
  if (!best || bestDist === 0) return null
  const threshold = best.length <= 4 ? 1 : best.length <= 7 ? 2 : 3
  return bestDist <= threshold ? best : null
}

interface SegmentExplain {
  summary: string
  flagNotes: string[]
  suggestion?: string
}

function explainSegment(seg: string): SegmentExplain | null {
  const tokens = tokenize(seg)
  let i = 0
  // 跳过 sudo 前缀和 FOO=bar 环境变量赋值前缀
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === 'sudo') {
      i += 1
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      i += 1
      continue
    }
    break
  }
  const base = tokens[i]
  if (!base) return null
  const doc = COMMAND_DOCS[base]
  const netMatch = matchNetworkPhrase(tokens.slice(i))

  // 多词短语命中(比如 "display current-configuration")更具体,优先采用；
  // 单词命中且 Unix 词典里也有同名命令时(比如 ping/telnet/reboot 本身就通用),让 Unix 释义优先
  if (netMatch && (netMatch.matchedLen >= 2 || !doc)) {
    return { summary: `【${netMatch.vendor}】${netMatch.summary}`, flagNotes: [] }
  }

  if (!doc) {
    // 知识库里没有这个命令,尝试猜测是不是拼写错误
    const guess = findClosestCommand(base)
    if (!guess) return null
    return {
      summary: `"${base}" 不是本地知识库收录的命令,疑似拼写错误`,
      flagNotes: [],
      suggestion: guess,
    }
  }

  const rest = tokens.slice(i + 1)
  let summary = doc.summary

  if (doc.subcommands) {
    const sub = rest.find((t) => !t.startsWith('-'))
    if (sub && doc.subcommands[sub]) {
      summary = doc.subcommands[sub]
    }
  }

  const flagNotes: string[] = []
  if (doc.flags) {
    const notable = collectNotableTokens(rest)
    for (const key of Object.keys(doc.flags)) {
      if (notable.has(key)) flagNotes.push(`${key} ${doc.flags[key]}`)
    }
  }

  return { summary, flagNotes }
}

export interface CommandHint {
  base: string
  flags: { flag: string; desc: string }[]
  subcommands?: { name: string; desc: string }[]
}

// 打字时的"参数速查":只看当前(管道最后一段)命令的 base,把知识库里记录的全部参数/子命令列出来,
// 供输入框旁边做实时提示——和 explainLocal 不同,这里不关心命令有没有打完整、有没有风险,只做速查表。
export function getCommandHint(command: string): CommandHint | null {
  const cmd = command.trim()
  if (!cmd) return null
  const segments = splitPipeline(cmd)
  const lastSeg = segments[segments.length - 1]
  if (!lastSeg) return null

  const tokens = tokenize(lastSeg)
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === 'sudo' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      i += 1
      continue
    }
    break
  }
  const base = tokens[i]
  if (!base) return null
  const doc = COMMAND_DOCS[base]
  if (!doc) return null

  const flags = doc.flags ? Object.entries(doc.flags).map(([flag, desc]) => ({ flag, desc })) : []
  const subcommands = doc.subcommands
    ? Object.entries(doc.subcommands).map(([name, desc]) => ({ name, desc }))
    : undefined
  if (!flags.length && !subcommands) return null
  return { base, flags, subcommands }
}

export function explainLocal(command: string): LocalExplain | null {
  const cmd = command.trim()
  if (!cmd) return null

  const segments = splitPipeline(cmd)
  const parts: SegmentExplain[] = []
  for (const seg of segments) {
    const r = explainSegment(seg)
    if (r) parts.push(r)
  }
  if (!parts.length) return null

  const summary = parts.length === 1 ? parts[0].summary : parts.map((p) => p.summary).join(' → ')

  const detailLines: string[] = parts.map((p, idx) => {
    let line = parts.length > 1 ? `第 ${idx + 1} 步:${p.summary}` : p.summary
    if (p.flagNotes.length) line += `\n参数说明:${p.flagNotes.join(';')}`
    if (p.suggestion) {
      const desc = describeGuess(p.suggestion)
      line += `\n💡 你是否想输入 "${p.suggestion}"?${desc ? `(${desc})` : ''}`
    }
    return line
  })

  const suggestion = parts.find((p) => p.suggestion)?.suggestion

  return { summary, detail: detailLines.join('\n\n'), suggestion }
}
