export type RiskLevel = 'safe' | 'caution' | 'danger'

export interface LocalRiskResult {
  level: RiskLevel
  matched: { title: string; reason: string }[]
}

interface Rule {
  level: Exclude<RiskLevel, 'safe'>
  title: string
  reason: string
  test: RegExp
}

// 本地高危/需谨慎命令规则库。瞬时匹配,不依赖网络。
const rules: Rule[] = [
  // ---- danger:可能造成不可逆的数据/系统损坏 ----
  {
    level: 'danger',
    title: '递归强制删除',
    reason: 'rm -rf 会递归强制删除,若路径为 /、~、* 或根级目录将造成不可恢复的数据丢失。',
    test: /\brm\b[^|;&\n]*\s-[a-z]*r[a-z]*f|\brm\b[^|;&\n]*\s-[a-z]*f[a-z]*r/i,
  },
  {
    level: 'danger',
    title: '删除根目录/家目录',
    reason: '目标包含 /、/* 或 ~ 等关键路径,删除后系统或用户数据将被清空。',
    test: /\brm\b[^|;&\n]*\s(-[a-z]+\s+)?(\/|\/\*|~|\$HOME)(\s|$)/i,
  },
  {
    level: 'danger',
    title: '磁盘写入 (dd)',
    reason: 'dd 直接写块设备,of=/dev/... 会覆盖分区/整盘数据,不可恢复。',
    test: /\bdd\b[^|\n]*\bof=\s*\/dev\//i,
  },
  {
    level: 'danger',
    title: '格式化文件系统',
    reason: 'mkfs / mke2fs 会格式化设备,清空其上所有数据。',
    test: /\bmkfs(\.\w+)?\b|\bmke2fs\b/i,
  },
  {
    level: 'danger',
    title: '重定向写入裸设备',
    reason: '将数据重定向到 /dev/sd*、/dev/nvme* 等裸设备会破坏磁盘数据。',
    test: />\s*\/dev\/(sd[a-z]|nvme\d|hd[a-z]|vd[a-z])/i,
  },
  {
    level: 'danger',
    title: 'Fork 炸弹',
    reason: '经典 fork 炸弹会耗尽进程资源导致系统卡死。',
    test: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  },
  {
    level: 'danger',
    title: '擦除磁盘签名',
    reason: 'wipefs -a / shred 会擦除文件系统签名或彻底销毁文件。',
    test: /\bwipefs\b[^|\n]*-a|\bshred\b/i,
  },
  {
    level: 'danger',
    title: '管道执行远程脚本',
    reason: 'curl/wget 下载内容直接管道给 sh/bash 执行,内容不可见,存在供应链风险。',
    test: /\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba)?sh\b/i,
  },
  {
    level: 'danger',
    title: '危险数据库操作',
    reason: 'DROP DATABASE / DROP TABLE / TRUNCATE 会删除数据库或表数据。',
    test: /\b(drop\s+(database|table)|truncate\s+table)\b/i,
  },
  {
    level: 'danger',
    title: '覆盖分区表',
    reason: '直接向整盘写入或操作分区表可能导致无法启动。',
    test: /\b(sfdisk|parted)\b[^|\n]*(--delete|rm|mklabel)/i,
  },

  // ---- caution:影响面较大,需确认 ----
  {
    level: 'caution',
    title: '全局权限放开',
    reason: 'chmod 777 或递归修改权限会带来安全隐患,-R 作用于大目录还可能误伤。',
    test: /\bchmod\b[^|\n]*(-[a-z]*R[a-z]*\s|\s)777/i,
  },
  {
    level: 'caution',
    title: '递归修改属主',
    reason: 'chown -R 对大目录递归改属主,误操作范围大。',
    test: /\bchown\b[^|\n]*-[a-z]*R/i,
  },
  {
    level: 'caution',
    title: '关机/重启',
    reason: 'shutdown / reboot / halt / poweroff / init 0|6 会中断服务器上的所有服务。',
    test: /\b(shutdown|reboot|halt|poweroff)\b|\binit\s+[06]\b/i,
  },
  {
    level: 'caution',
    title: '批量结束进程',
    reason: 'kill -9 -1 / killall / pkill 可能一次性终止大量进程。',
    test: /\bkill\b\s+-9\s+-1|\bkillall\b|\bpkill\b/i,
  },
  {
    level: 'caution',
    title: '清空防火墙规则',
    reason: 'iptables -F / ufw disable 会清空或关闭防火墙,可能导致失联或暴露端口。',
    test: /\biptables\b[^|\n]*-F|\bufw\b\s+disable/i,
  },
  {
    level: 'caution',
    title: '强制推送/硬重置',
    reason: 'git push --force / reset --hard 会覆盖历史或丢弃未提交改动。',
    test: /\bgit\b[^|\n]*(push[^|\n]*(--force|-f)\b|reset[^|\n]*--hard)/i,
  },
  {
    level: 'caution',
    title: '提权执行',
    reason: '以 root 权限执行,操作影响范围和风险都会放大,请确认命令内容。',
    test: /^\s*sudo\b/i,
  },
]

export function analyzeLocal(command: string): LocalRiskResult {
  const cmd = command.trim()
  if (!cmd) return { level: 'safe', matched: [] }
  const matched: LocalRiskResult['matched'] = []
  let level: RiskLevel = 'safe'
  for (const r of rules) {
    if (r.test.test(cmd)) {
      matched.push({ title: r.title, reason: r.reason })
      if (r.level === 'danger') level = 'danger'
      else if (level !== 'danger') level = 'caution'
    }
  }
  return { level, matched }
}
