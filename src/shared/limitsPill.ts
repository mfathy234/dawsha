import { AGENT_NAMES } from './agents'
import { meterLimits, type AgentLimitStore, type AgentLimits } from './agentLimits'
import { ringSpecs, type RingSpec } from './limitRings'
import type { AgentKind, TabAgent } from './types'

const PILL_AGENTS: readonly AgentKind[] = ['claude', 'codex']

export interface PillAgent {
  agent: AgentKind
  stale: boolean
  rings: RingSpec[]
}

/** Everything the limits pill shows, as plain data: the rings per agent, or the "no limits reported" state. */
export interface LimitsPillModel {
  hidden: boolean
  stale: boolean
  /** The focused agent, shown with "no limits reported" when no agent has a reading. */
  empty: AgentKind | null
  agents: PillAgent[]
  ariaLabel: string
  title: string
}

function pillAgents(store: AgentLimitStore, focused: AgentLimits | null, now: number, compact: boolean, visible: readonly AgentKind[] | null): PillAgent[] {
  const kinds: AgentKind[] = [...PILL_AGENTS]
  if (focused && !kinds.includes(focused.agent) && focused.windows.length > 0) kinds.push(focused.agent)
  const found: PillAgent[] = []
  for (const agent of kinds) {
    if (visible && !visible.includes(agent)) continue
    const entry = meterLimits(store, agent, now)
    if (!entry || entry.state === 'none' || entry.windows.length === 0) continue
    found.push({ agent, stale: entry.state === 'stale', rings: ringSpecs(AGENT_NAMES[agent], entry.windows, now, compact) })
  }
  return found
}

/** `focusedAgent` is the agent of the focused pane, or null (no pane, or a shell). `visible` limits which agents are listed (null lists all). */
export function limitsPillModel(store: AgentLimitStore, focusedAgent: TabAgent | null, now: number, compact: boolean, visible: readonly AgentKind[] | null = null): LimitsPillModel {
  const focused = meterLimits(store, focusedAgent, now)
  const agents = pillAgents(store, focused, now, compact, visible)
  const full = compact ? pillAgents(store, focused, now, false, visible) : agents
  const stale = focused?.state === 'stale'
  if (agents.length === 0) {
    const name = focused ? AGENT_NAMES[focused.agent] : 'Agent'
    const label = `${name} limits${stale ? ' (stale)' : ''}: no limits reported. Show limits for every agent`
    return { hidden: focused === null, stale, empty: focused?.agent ?? null, agents, ariaLabel: label, title: `${name}: no limits reported` }
  }
  const titles = (list: PillAgent[]): string[] => list.flatMap((item) => item.rings.map((ring) => ring.title))
  const shown = focused && focused.windows.length > 0 ? titles(full.filter((item) => item.agent === focused.agent)) : titles(full)
  const name = focused ? AGENT_NAMES[focused.agent] : 'Agent'
  return {
    hidden: false,
    stale,
    empty: null,
    agents,
    ariaLabel: `${name} limits${stale ? ' (stale)' : ''}: ${(shown.length > 0 ? shown : titles(full)).join('; ')}. Show limits for every agent`,
    title: titles(full).join('; ')
  }
}
