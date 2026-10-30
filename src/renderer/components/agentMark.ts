import { AGENT_MARKS, agentLabel } from '../../shared/agents'
import type { AgentKind, TabAgent } from '../../shared/types'
import { h } from '../dom'

// A letter tile in the agent's colour (C, X, G), the mark the 1.8.0 design uses everywhere in the app.
export function agentMark(agent: TabAgent, extraClass = ''): HTMLElement | null {
  if (agent === 'shell') return null
  const kind: AgentKind = agent
  return h('span', { class: `agent-mark ${kind} ${extraClass}`.trim(), title: agentLabel(kind), 'aria-hidden': 'true' }, AGENT_MARKS[kind])
}
