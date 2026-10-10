import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProcessActivity, ProcessRoot } from '../shared/processActivity'

export interface ProcessRecord {
  pid: number
  parentPid: number | null
  name: string
  startedAt: number | null
}

const execFileAsync = promisify(execFile)
const MAX_RECORDS = 4096
const MAX_PER_ROOT = 128
const ROOT_START_TOLERANCE_MS = 60_000
const SCRIPT = `$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; name=[string]$_.Name; startedAt=([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } }) | ConvertTo-Json -Compress`

function validRecord(raw: unknown): raw is ProcessRecord {
  if (!raw || typeof raw !== 'object') return false
  const value = raw as Record<string, unknown>
  return Number.isInteger(value.pid) && (value.pid as number) > 0 &&
    Number.isInteger(value.parentPid) && typeof value.name === 'string' &&
    (value.name as string).length <= 120 && Number.isFinite(value.startedAt)
}

export async function readWindowsProcesses(): Promise<ProcessRecord[]> {
  if (process.platform !== 'win32') return []
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], {
    windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024
  })
  const raw: unknown = JSON.parse(stdout)
  return (Array.isArray(raw) ? raw : [raw]).slice(0, MAX_RECORDS).filter(validRecord)
}

export function selectProcessActivity(roots: readonly ProcessRoot[], records: readonly ProcessRecord[]): ProcessActivity[] {
  const byPid = new Map(records.slice(0, MAX_RECORDS).map((record) => [record.pid, record]))
  const children = new Map<number, ProcessRecord[]>()
  for (const record of byPid.values()) {
    if (record.parentPid === null) continue
    const siblings = children.get(record.parentPid) ?? []
    siblings.push(record)
    children.set(record.parentPid, siblings)
  }
  const found: ProcessActivity[] = []
  for (const root of roots) {
    const process = byPid.get(root.pid)
    if (!process || process.startedAt === null || Math.abs(process.startedAt - root.startedAt) > ROOT_START_TOLERANCE_MS) continue
    const pending = [process]
    const seen = new Set<number>()
    while (pending.length > 0 && seen.size < MAX_PER_ROOT) {
      const current = pending.shift()!
      if (seen.has(current.pid)) continue
      seen.add(current.pid)
      found.push({ tabId: root.tabId, pid: current.pid, name: current.name, parentPid: current.parentPid, startedAt: current.startedAt, alive: true })
      for (const child of children.get(current.pid) ?? []) {
        if (child.startedAt !== null && current.startedAt !== null && child.startedAt >= current.startedAt) pending.push(child)
      }
    }
  }
  return found
}

export async function collectProcessActivity(
  roots: readonly ProcessRoot[],
  reader: () => Promise<ProcessRecord[]> = readWindowsProcesses
): Promise<ProcessActivity[]> {
  if (roots.length === 0) return []
  try {
    return selectProcessActivity(roots, await reader())
  } catch {
    return []
  }
}
