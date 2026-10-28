import type { RunSnapshot } from './runCommands'

const folderKey = (folder: string): string => folder.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

const PORT = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\*):(\d{2,5})\b/gi
const WORDED_PORT = /\bport\s+(\d{2,5})\b/gi

/** The port a dev server announced in its output (the last one it printed), or null when it printed none. */
export function detectPort(output: string): number | null {
  const tail = output.slice(-8000).replace(/\u001b\[[0-9;]*m/g, '')
  let port: number | null = null
  for (const pattern of [PORT, WORDED_PORT]) {
    pattern.lastIndex = 0
    for (let found = pattern.exec(tail); found; found = pattern.exec(tail)) {
      const value = Number(found[1])
      if (value >= 80 && value <= 65535) port = value
    }
    if (port !== null) return port
  }
  return null
}

/** The label of a run's tab: "Run · dev", with the checkout's folder when the run belongs to another one. */
export function runTabLabel(run: Pick<RunSnapshot, 'name' | 'folder'>, currentFolder: string | null): string {
  const same = currentFolder !== null && folderKey(run.folder) === folderKey(currentFolder)
  const where = same ? '' : ` · ${run.folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''}`
  return `Run · ${run.name}${where}`
}

export interface RunningSummary {
  name: string
  port: number | null
}

/** The command the status bar names: the newest run of this checkout that is still running. */
export function runningSummary(runs: readonly RunSnapshot[], folder: string | null): RunningSummary | null {
  if (folder === null) return null
  const key = folderKey(folder)
  const live = runs
    .filter((run) => folderKey(run.folder) === key && (run.status === 'running' || run.status === 'stopping'))
    .sort((a, b) => b.startedAt - a.startedAt)[0]
  return live ? { name: live.name, port: detectPort(live.output) } : null
}

export const runningText = (summary: RunningSummary): string => `${summary.name} running${summary.port === null ? '' : ` · :${summary.port}`}`
