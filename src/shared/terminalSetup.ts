export interface TerminalSetupState {
  phase: 'running' | 'failed'
  exitCode?: number
}

export type TerminalSetupAction = 'retry' | 'start'
import { INSTRUCTIONS_MAX, isCrewLaunch } from './crew'
import type { SpawnRequest } from './types'


export type PendingSetupLaunch = Pick<SpawnRequest, 'agent' | 'prompt' | 'initialInput' | 'command' | 'crew' | 'fullAccess'>
export interface PendingWorktreeSetup {
  path: string
  repo: string
  launch?: PendingSetupLaunch
}

const absolutePath = (value: unknown): value is string => typeof value === 'string' && value.length <= 32768 && !value.includes('\0') && /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value)
const text = (value: unknown): string | undefined => typeof value === 'string' && !value.includes('\0') ? value.slice(0, 100_000) : undefined

export function sanitizePendingWorktrees(value: unknown): PendingWorktreeSetup[] {
  if (!Array.isArray(value)) return []
  const result: PendingWorktreeSetup[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || !absolutePath(item.path) || !absolutePath(item.repo)) continue
    const key = /^[a-z]:|^\\\\/i.test(item.path) ? item.path.replace(/\//g, '\\').toLowerCase() : item.path
    if (seen.has(key)) continue
    seen.add(key)
    const entry: PendingWorktreeSetup = { path: item.path, repo: item.repo }
    const launch = item.launch
    if (launch && typeof launch === 'object' && ['claude', 'codex', 'gemini', 'shell'].includes(launch.agent)) {
      entry.launch = { agent: launch.agent }
      for (const name of ['prompt', 'initialInput', 'command'] as const) {
        const kept = text(launch[name])
        if (kept !== undefined) entry.launch[name] = kept
      }
      if (typeof launch.fullAccess === 'boolean') entry.launch.fullAccess = launch.fullAccess
      if (isCrewLaunch(launch.crew)) entry.launch.crew = { ...launch.crew, instructions: launch.crew.instructions.slice(0, INSTRUCTIONS_MAX), model: launch.crew.model.slice(0, 200) }
    }
    result.push(entry)
    if (result.length === 500) break
  }
  return result
}
