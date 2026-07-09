import { getLlmConfig, isLlmEnabled } from './settings.js'
import type { RiskLevel } from './riskEngine.js'

export interface LlmAnalysis {
  summary: string // 一句话:这条命令做什么
  detail: string // 展开说明 / 参数含义
  risk: RiskLevel // 大模型判断的风险等级
  riskReason: string // 风险原因(无风险则为空)
  suggestion: string // 疑似拼写错误/命令不存在时,给出最可能想输入的正确命令;无则空字符串
  model: string // 实际使用的模型
}

export interface NlCommandResult {
  command: string // 生成的 shell 命令
  explanation: string // 简短说明这条命令做什么
  model: string
}

const SYSTEM_PROMPT = `你是一个运维命令行安全助手,同时精通 Linux/Unix shell 命令,以及常见网络设备的命令行:华为/H3C VRP(交换机、以及同一命令体系的华为 USG 防火墙)、Fortinet FortiGate(FortiOS)、MikroTik RouterOS、Aruba ArubaOS(无线控制器/AP)。用户会给你一条命令,你需要先判断它更像哪种设备/系统的命令,再用简体中文分析。
只输出一个 JSON 对象,不要包含 markdown 代码块或额外文字,字段如下:
{
  "summary": "一句话说明这条命令做什么(20字内)",
  "detail": "逐段解释命令及关键参数含义,简洁清晰;如果是网络设备命令,请说明是哪种设备/系统的命令",
  "risk": "safe | caution | danger 三选一",
  "riskReason": "若有风险,说明风险点;无风险则填空字符串",
  "suggestion": "如果命令名疑似拼写错误或该命令根本不存在(比如把 git 打成了 gti,或把 display 打成了 dispaly),给出你认为用户最可能想输入的正确命令;如果命令是合法的、没有拼写问题,填空字符串"
}
判断风险时重点关注:数据删除、磁盘写入、格式化、权限变更、关机重启、结束进程、防火墙/安全策略变更、NAT/路由变更、清空配置(reset saved-configuration 等)、远程脚本执行、提权等。
判断拼写错误时优先考虑:字母顺序颠倒(gti/git、dispaly/display)、相邻按键打错、常见命令的常见别字,只在确实像是打错时才给 suggestion,不要对合法但少见的命令瞎猜。`

const NL2CMD_SYSTEM_PROMPT = `你是一个运维命令行专家,精通 Linux/Unix shell,以及华为/H3C VRP、Fortinet FortiGate(FortiOS)、MikroTik RouterOS、Aruba ArubaOS 等网络设备命令行。用户会用自然语言描述想做的事情,你需要给出最合适的一条命令(如果确实需要多步,Linux 下可用 && 或 ; 连接成一行;网络设备命令如果需要多条,用换行分隔)。
只输出一个 JSON 对象,不要包含 markdown 代码块或额外文字,字段如下:
{
  "command": "可以直接执行/输入的命令,不要包含任何解释性文字",
  "explanation": "一句话说明这条命令做什么、关键参数含义(30字内)"
}
默认按 Linux/Unix shell 命令回答;只有当用户明确提到具体设备品牌/系统(如"华为交换机""USG""飞塔""FortiGate""RouterOS""Aruba AC/AP"等)时,才给出对应厂商的命令语法。
只给出命令本身,不要编造用户没提到的具体路径/IP/用户名等参数占位符之外的内容;如果用户的描述缺少必要信息(比如具体文件名),用常见的占位符或最常见的默认做法。`

async function callLlmChat(systemPrompt: string, userContent: string, timeoutMs: number): Promise<{ content: string; model: string }> {
  if (!isLlmEnabled()) throw new Error('大模型网关未配置')

  const { baseUrl, apiKey, model } = getLlmConfig()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
      signal: controller.signal,
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`网关返回 ${resp.status}: ${text.slice(0, 200)}`)
    }
    const data: any = await resp.json()
    const content: string = data?.choices?.[0]?.message?.content ?? ''
    return { content, model }
  } finally {
    clearTimeout(timer)
  }
}

// 提取 JSON 内容:去掉可能的 ```json ``` 包裹,只保留最外层大括号之间的部分
function extractJson(content: string): string {
  let raw = content.trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1)
  return raw
}

export async function analyzeWithLlm(command: string, timeoutMs = 12000): Promise<LlmAnalysis> {
  const { content, model } = await callLlmChat(SYSTEM_PROMPT, command, timeoutMs)
  return parseAnalysis(content, model)
}

export async function nl2cmd(instruction: string, timeoutMs = 15000): Promise<NlCommandResult> {
  const { content, model } = await callLlmChat(NL2CMD_SYSTEM_PROMPT, instruction, timeoutMs)
  return parseNlCommand(content, model)
}

function parseAnalysis(content: string, model: string): LlmAnalysis {
  const raw = extractJson(content)
  try {
    const obj = JSON.parse(raw)
    const risk: RiskLevel = ['safe', 'caution', 'danger'].includes(obj.risk) ? obj.risk : 'safe'
    return {
      summary: String(obj.summary ?? '').slice(0, 200),
      detail: String(obj.detail ?? ''),
      risk,
      riskReason: String(obj.riskReason ?? ''),
      suggestion: String(obj.suggestion ?? '').trim(),
      model,
    }
  } catch {
    // 解析失败时,把原文塞进 detail 兜底
    return { summary: '', detail: content.slice(0, 800), risk: 'safe', riskReason: '', suggestion: '', model }
  }
}

function parseNlCommand(content: string, model: string): NlCommandResult {
  const raw = extractJson(content)
  try {
    const obj = JSON.parse(raw)
    return {
      command: String(obj.command ?? '').trim(),
      explanation: String(obj.explanation ?? '').trim(),
      model,
    }
  } catch {
    // 解析失败时,把原始返回内容整段当作命令兜底(去掉多余空行)
    return { command: content.trim().slice(0, 500), explanation: '', model }
  }
}
