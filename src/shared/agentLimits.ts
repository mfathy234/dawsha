import { AGENTS } from './agents'
import type { AgentKind, RateLimitWindow, TabAgent } from './types'

export interface AgentLimitEntry {
  windows: RateLimitWindow[]
  at: number
}

/** The latest limit windows each agent reported, with when. Limits belong to an account, so they are kept per agent, never per pane. */
export type AgentLimitStore = Readonly<Partial<Record<AgentKind, AgentLimitEntry>>>

export interface LimitObservation {
  agent: TabAgent
  windows: readonly RateLimitWindow[]
  at: number
}

export type LimitsState = 'none' | 'fresh' | 'stale'

export interface AgentLimits {
  agent: AgentKind
  state: LimitsState
  windows: RateLimitWindow[]
  at: number | null
}

export const LIMITS_STALE_MS = 30 * 60_000

/** The store after folding in the readings; it is the same object when nothing is newer, so callers can compare by reference. */
export function recordLimits(store: AgentLimitStore, observations: readonly LimitObservation[]): AgentLimitStore {
  let next = store
  for (const { agent, windows, at } of observations) {
    if (agent === 'shell' || windows.length === 0) continue
    const known = next[agent]
    if (known && known.at >= at) continue
    next = { ...next, [agent]: { windows: [...windows], at } }
  }
  return next
}

/** Old by the clock, or every window with a known reset has already reset, so the percentages no longer describe now. */
export function limitsStale(entry: AgentLimitEntry, now: number): boolean {
  if (now - entry.at > LIMITS_STALE_MS) return true
  const resets = entry.windows.filter((window) => window.resetsAt !== null)
  return resets.length > 0 && resets.every((window) => (window.resetsAt as number) <= now)
}

export function agentLimits(store: AgentLimitStore, agent: AgentKind, now: number): AgentLimits {
  const entry = store[agent]
  if (!entry) return { agent, state: 'none', windows: [], at: null }
  return { agent, state: limitsStale(entry, now) ? 'stale' : 'fresh', windows: entry.windows, at: entry.at }
}

/** What the top bar shows for the focused pane: only that pane's agent, never another agent's numbers. Null for a shell or no pane. */
export function focusedLimits(store: AgentLimitStore, focused: TabAgent | null, now: number): AgentLimits | null {
  if (focused === null || focused === 'shell') return null
  return agentLimits(store, focused, now)
}

export const allAgentLimits = (store: AgentLimitStore, now: number): AgentLimits[] => AGENTS.map((agent) => agentLimits(store, agent, now))

/** "just now", "4m ago", "2h ago", "3d ago". */
export function dataAge(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}
