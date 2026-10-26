import { api } from './api'
import { BG_RANGES, DEFAULT_BG_FILTERS, type BackgroundAgentsReport, type BgFilters } from '../shared/backgroundAgents'

type Listener = () => void

let report: BackgroundAgentsReport | null = null
let filters: BgFilters = DEFAULT_BG_FILTERS
let failed = false
let token = 0
const listeners = new Set<Listener>()

const notify = (): void => listeners.forEach((listener) => listener())

export const agentsReport = (): BackgroundAgentsReport | null => report
export const agentsFilters = (): BgFilters => filters
export const agentsFailed = (): boolean => failed
export const runningAgents = (): number => report?.agents.filter((agent) => agent.status === 'running').length ?? 0

export function onAgentsChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Filters last for the app session; changing the range reloads. */
export function setAgentFilters(next: BgFilters): void {
  const rangeChanged = next.range !== filters.range
  filters = next
  notify()
  if (rangeChanged) void refreshAgents()
}

export async function refreshAgents(): Promise<void> {
  const mine = ++token
  const range = filters.range
  if (!BG_RANGES.some((entry) => entry.value === range)) return
  try {
    const next = await api.backgroundAgents(range)
    if (mine !== token) return
    report = next
    failed = false
  } catch {
    if (mine !== token) return
    failed = true
  }
  notify()
}

/** One read at start and whenever the window comes back, so the tab's count is not blank; no polling while hidden. */
export function installBackgroundAgents(): void {
  window.setTimeout(() => void refreshAgents(), 2500)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshAgents()
  })
}
