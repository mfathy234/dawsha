import { AGENTS, AGENT_NAMES } from '../shared/agents'
import { limitsStale, type AgentLimitStore } from '../shared/agentLimits'
import { detectLimitWarnings, warningDetail, warningTitle, type LimitReading, type WarnedWindows } from '../shared/limitWarnings'
import { toast } from './components/toast'

const STORAGE_KEY = 'dawsha.limitWarned'

function load(): WarnedWindows {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as WarnedWindows) : {}
  } catch {
    return {}
  }
}

function save(warned: WarnedWindows): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(warned))
  } catch {
    // Not being able to remember a warning only means it may show once more after a restart.
  }
}

let warned: WarnedWindows | null = null

export function limitReadings(store: AgentLimitStore, now: number): LimitReading[] {
  return AGENTS.flatMap((agent) => {
    const entry = store[agent]
    if (!entry) return []
    const stale = limitsStale(entry, now)
    return entry.windows.map((window) => ({ agent, window, stale: stale || (window.resetsAt !== null && window.resetsAt <= now) }))
  })
}

/**
 * One notification each time a limit window rises across 80%. The warned windows are remembered between launches, so a
 * window that is already high when Dawsha opens warns once, not on every launch. Stale readings never warn.
 */
export function checkLimitWarnings(store: AgentLimitStore, now: number): void {
  warned ??= load()
  const result = detectLimitWarnings(warned, limitReadings(store, now))
  if (result.warned !== warned) {
    warned = result.warned
    save(warned)
  }
  for (const { agent, window } of result.fire) toast(`${warningTitle(AGENT_NAMES[agent], window)}. ${warningDetail(window, now)}`, 'info')
}
