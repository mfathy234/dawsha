import { AGENT_MARKS, agentLabel } from '../../shared/agents'
import type { AgentKind, TabAgent } from '../../shared/types'
import { h } from '../dom'
import { brandLogo } from '../brandLogo'

export function agentMark(agent: TabAgent, extraClass = ''): HTMLElement | null {
  if (agent === 'shell') return null
  const kind: AgentKind = agent
  const logo = brandLogo(kind)
  const attrs = { title: agentLabel(kind), 'aria-hidden': 'true' }
  if (!logo) return h('span', { class: `agent-mark ${kind} ${extraClass}`.trim(), ...attrs }, AGENT_MARKS[kind])
  const mark = h('span', { class: `agent-mark brand ${kind} ${extraClass}`.trim(), ...attrs })
  mark.innerHTML = logo
  return mark
}
