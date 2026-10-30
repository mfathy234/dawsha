import { execFileSync } from 'node:child_process'
import type { QuitLog } from './quitLog'

export interface AppProcessMetric {
  pid: number
  type: string
}

export function utilityChildPids(metrics: readonly AppProcessMetric[], selfPid: number): number[] {
  return metrics.filter((metric) => metric.type === 'Utility' && metric.pid !== selfPid).map((metric) => metric.pid)
}

export function killProcessTree(pid: number, log: QuitLog, platform = process.platform): void {
  try {
    if (platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 2000 })
    else process.kill(pid, 'SIGKILL')
  } catch (error) {
    log(`child kill failed pid=${pid}: ${(error as Error).message}`)
  }
}

export function killAppUtilityChildren(metrics: readonly AppProcessMetric[], selfPid: number, log: QuitLog): number[] {
  const pids = utilityChildPids(metrics, selfPid)
  for (const pid of pids) {
    log(`stopping leftover utility child pid=${pid}`)
    killProcessTree(pid, log)
  }
  return pids
}
