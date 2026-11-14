import type { AgentKind } from './types'
import { RING_WARN_AT, ringWindowName } from './limitRings'
import { formatPercent } from './statusLine'
import { formatResetIn } from './topbarSummary'
import type { RateLimitWindow } from './types'
import { limitsStale, type AgentLimitStore } from './agentLimits'

/** A reset is a reading whose reset time moved on by more than this (a jitter of seconds is not a new window). */
export const RESET_JUMP_MS = 10 * 60_000

export interface LimitReading {
  agent: AgentKind
  window: RateLimitWindow
  /** Stale data, or a window that has already reset, never warns and never changes what is remembered. */
  stale: boolean
}

export interface WarnedWindow {
  /** The reset time of the window we already warned about. */
  resetsAt: number | null
  threshold?: 80 | 95
}

/** Highest threshold delivered for each agent/window, retained until a reset. */
export type WarnedWindows = Readonly<Record<string, WarnedWindow>>

export const windowId = (agent: AgentKind, window: RateLimitWindow): string => `${agent}:${window.key}`

function sameWindow(known: WarnedWindow, resetsAt: number | null): boolean {
  if (known.resetsAt === null || resetsAt === null) return true
  return resetsAt - known.resetsAt <= RESET_JUMP_MS
}

export interface WarningResult {
  warned: WarnedWindows
  fire: LimitReading[]
}

/**
 * Warn at 80% and again at 95%, once per window until it resets. A jump across both
 * thresholds produces one notice at the current percentage and remembers both.
 */
export function detectLimitWarnings(previous: WarnedWindows, readings: readonly LimitReading[]): WarningResult {
  let warned = previous
  const fire: LimitReading[] = []
  for (const reading of readings) {
    if (reading.stale) continue
    if (reading.agent !== 'claude' && reading.agent !== 'codex') continue
    if (reading.window.key !== 'five_hour' && reading.window.key !== 'seven_day') continue
    if (!Number.isFinite(reading.window.percent)) continue
    const id = windowId(reading.agent, reading.window)
    const known = warned[id]
    const threshold = reading.window.percent >= 95 ? 95 : reading.window.percent >= RING_WARN_AT ? 80 : null
    if (threshold === null) continue
    const same = known && sameWindow(known, reading.window.resetsAt)
    if (same && (known.threshold ?? 80) >= threshold) {
      // Enrich a previously unknown reset without losing deduplication.
      if (known.resetsAt === null && reading.window.resetsAt !== null) warned = { ...warned, [id]: { ...known, resetsAt: reading.window.resetsAt } }
      continue
    }
    fire.push(reading)
    warned = { ...warned, [id]: { resetsAt: reading.window.resetsAt ?? (same ? known.resetsAt : null), threshold } }
  }
  return { warned, fire }
}

export function sanitizeWarnedWindows(value: unknown): WarnedWindows {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const clean: Record<string, WarnedWindow> = {}
  for (const agent of ['claude', 'codex']) {
    for (const key of ['five_hour', 'seven_day']) {
      const id = `${agent}:${key}`
      const entry = raw[id]
      if (!entry || typeof entry !== 'object') continue
      const { resetsAt, threshold } = entry as Record<string, unknown>
      if (resetsAt !== null && (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0)) continue
      if (threshold !== undefined && threshold !== 80 && threshold !== 95) continue
      clean[id] = { resetsAt: resetsAt as number | null, threshold: threshold === 95 ? 95 : 80 }
    }
  }
  return clean
}

export function limitReadings(store: AgentLimitStore, now: number): LimitReading[] {
  return (['claude', 'codex'] as const).flatMap(agent => {
    const entry = store[agent]
    if (!entry) return []
    const stale = limitsStale(entry, now)
    return entry.windows.map(window => ({ agent, window, stale: stale || (window.resetsAt !== null && window.resetsAt <= now) }))
  })
}

export function desktopWarningText(agentName: string, window: RateLimitWindow): string {
  const period = window.key === 'seven_day' ? 'weekly' : '5-hour'
  const reset = window.resetsAt === null ? 'Reset time is not reported.'
    : `It resets at ${new Date(window.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}${window.key === 'seven_day' ? ` on ${new Date(window.resetsAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}.`
  return `${agentName} is at ${formatPercent(window.percent)} of its ${period} limit. ${reset}`
}

/** "Claude's 5-hour limit is at 84%". */
export const warningTitle = (agentName: string, window: RateLimitWindow): string =>
  `${agentName}'s ${ringWindowName(window)} limit is at ${formatPercent(window.percent)}`

/** "Resets in 1h 12m. Sessions keep running." */
export function warningDetail(window: RateLimitWindow, now: number): string {
  const reset = formatResetIn(window.resetsAt, now)
  return `${reset ? `Resets in ${reset}. ` : ''}Sessions keep running.`
}
