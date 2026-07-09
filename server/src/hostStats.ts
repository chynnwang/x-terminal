import { execCommand } from './sftp.js'

export interface HostStats {
  cpuPercent: number | null
  memPercent: number | null
  diskPercent: number | null
  error?: string
}

// 一次 exec 里做两次 /proc/stat 采样(间隔 0.3s)算 CPU 使用率,
// 顺带跑 free -b 和 df -Pk /,一次往返拿到三项指标,减少连接开销
const STATS_SCRIPT = `
c1=$(grep '^cpu ' /proc/stat 2>/dev/null)
sleep 0.3
c2=$(grep '^cpu ' /proc/stat 2>/dev/null)
echo "CPU1=$c1"
echo "CPU2=$c2"
free -b 2>/dev/null | grep -i '^mem'
df -Pk / 2>/dev/null | tail -1
`.trim()

export async function getHostStats(hostId: string): Promise<HostStats> {
  try {
    const out = await execCommand(hostId, STATS_SCRIPT, 8000)
    return parseStats(out)
  } catch (e: any) {
    return { cpuPercent: null, memPercent: null, diskPercent: null, error: e?.message || '采集失败' }
  }
}

function parseCpuLine(line: string): number[] {
  return line
    .replace(/^CPU\d=cpu\s+/, '')
    .trim()
    .split(/\s+/)
    .map(Number)
}

export function parseStats(out: string): HostStats {
  const lines = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  let cpuPercent: number | null = null
  let memPercent: number | null = null
  let diskPercent: number | null = null

  try {
    const l1 = lines.find((l) => l.startsWith('CPU1=cpu'))
    const l2 = lines.find((l) => l.startsWith('CPU2=cpu'))
    if (l1 && l2) {
      const a = parseCpuLine(l1)
      const b = parseCpuLine(l2)
      const totalA = a.reduce((s, n) => s + (n || 0), 0)
      const totalB = b.reduce((s, n) => s + (n || 0), 0)
      const idleA = (a[3] || 0) + (a[4] || 0)
      const idleB = (b[3] || 0) + (b[4] || 0)
      const totalDiff = totalB - totalA
      const idleDiff = idleB - idleA
      if (totalDiff > 0) {
        cpuPercent = Math.round(Math.max(0, Math.min(100, 100 * (1 - idleDiff / totalDiff))))
      }
    }
  } catch {
    /* 采集失败就留空,不影响其他指标 */
  }

  try {
    const memLine = lines.find((l) => /^Mem:/i.test(l))
    if (memLine) {
      const parts = memLine.split(/\s+/)
      const total = Number(parts[1])
      const available = Number(parts[6] ?? parts[3])
      if (total > 0 && !Number.isNaN(available)) {
        memPercent = Math.round(Math.max(0, Math.min(100, 100 * (1 - available / total))))
      }
    }
  } catch {
    /* 同上 */
  }

  try {
    const dfLine = lines[lines.length - 1]
    const m = dfLine?.match(/(\d+)%/)
    if (m) diskPercent = Number(m[1])
  } catch {
    /* 同上 */
  }

  if (cpuPercent === null && memPercent === null && diskPercent === null) {
    return { cpuPercent, memPercent, diskPercent, error: '无法解析(设备可能不是标准 Linux shell)' }
  }
  return { cpuPercent, memPercent, diskPercent }
}
