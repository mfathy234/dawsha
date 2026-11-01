import type { AgentKind } from './types'
import { RING_WARN_AT, ringWindowName } from './limitRings'
import { formatPercent } from './statusLine'
import { formatResetIn } from './topbarSummary'
import type { RateLimitWindow } from './types'

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
}

/** Windows we have warned about and not yet seen drop below the line or reset. Plain data so it can be saved between launches. */
export type WarnedWindows = Readonly<Record<string, WarnedWindow>>

export const windowId = (agent: AgentKind, window: RateLimitWindow): string => `${agent}:${window.key}`

function sameWindow(known: WarnedWindow, resetsAt: number | null): boolean {
  if (known.resetsAt === null || resetsAt === null) return known.resetsAt === resetsAt
  return resetsAt - known.resetsAt <= RESET_JUMP_MS
}

export interface WarningResult {
  warned: WarnedWindows
  fire: LimitReading[]
}

/**
 * One warning each time a window rises across 80%. It is not repeated until the window has dropped below 80 and crossed again,
 * and a window reset re-arms it. A window already above 80 on the first reading is warned about unless the saved
 * state says we already did for this same window.
 */
export function detectLimitWarnings(previous: WarnedWindows, readings: readonly LimitReading[]): WarningResult {
  let warned = previous
  const fire: LimitReading[] = []
  for (const reading of readings) {
    if (reading.stale) continue
    const id = windowId(reading.agent, reading.window)
    const known = warned[id]
    const above = reading.window.percent >= RING_WARN_AT
    if (!above) {
      if (known) warned = Object.fromEntries(Object.entries(warned).filter(([key]) => key !== id))
      continue
    }
    if (known && sameWindow(known, reading.window.resetsAt)) continue
    fire.push(reading)
    warned = { ...warned, [id]: { resetsAt: reading.window.resetsAt } }
  }
  return { warned, fire }
}

/** "Claude's 5-hour limit is at 84%". */
export const warningTitle = (agentName: string, window: RateLimitWindow): string =>
  `${agentName}'s ${ringWindowName(window)} limit is at ${formatPercent(window.percent)}`

/** "Resets in 1h 12m. Sessions keep running." */
export function warningDetail(window: RateLimitWindow, now: number): string {
  const reset = formatResetIn(window.resetsAt, now)
  return `${reset ? `Resets in ${reset}. ` : ''}Sessions keep running.`
}
