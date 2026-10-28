import { layoutTimeline } from '../../shared/agentTimeline'
import { STATUS_LABELS, barLabel, spanLabel, type BackgroundAgent, type BgSessionGroup } from '../../shared/backgroundAgents'
import { h } from '../dom'
import { agentMark } from './agentMark'
import { statusGlyph } from './backgroundAgentsDetail'

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** One lane per session and one per agent below it, on a shared time axis. Bars are the only focusable part of a lane. */
export function timelineView(groups: readonly BgSessionGroup[], now: number, selected: string | null, onSelect: (key: string) => void): HTMLElement {
  const timeline = layoutTimeline(groups, now)
  const byKey = new Map<string, BackgroundAgent>(groups.flatMap((group) => group.agents).map((agent) => [agent.key, agent]))
  const marks = new Map(groups.map((group) => [group.sessionKey, group.agentKind]))
  let session = ''
  const rows = timeline.lanes.map((lane) => {
    if (lane.kind === 'session') {
      session = lane.key
      return h('div', { class: 'bg-tl-row session', role: 'presentation' },
        h('span', { class: 'bg-tl-name', title: lane.title }, agentMark(marks.get(lane.key) ?? 'claude'), h('span', { class: 'bg-tl-text' }, lane.title)),
        h('div', { class: 'bg-tl-track' }, h('span', { class: 'bg-tl-span', 'aria-hidden': 'true', style: `left:${lane.left}%;width:${lane.width}%` })))
    }
    const agent = byKey.get(lane.key)!
    const tip = `${agent.description} · ${STATUS_LABELS[agent.status]} · ${spanLabel(lane.endedAt - lane.startedAt)}`
    return h('div', { class: `bg-tl-row${lane.key === selected ? ' selected' : ''}`, 'data-session': session, onClick: () => onSelect(lane.key) },
      h('span', { class: `bg-tl-name st-${agent.status}`, title: agent.description },
        h('span', { class: 'bg-tl-state', 'aria-hidden': 'true' }, statusGlyph(agent.status)),
        h('span', { class: 'bg-tl-text' }, agent.description)),
      h('div', { class: 'bg-tl-track' },
        h('button', {
          class: `bg-tl-bar st-${agent.status}`, type: 'button', 'data-key': lane.key, 'data-status': agent.status, title: tip, 'aria-label': barLabel(agent, now), 'aria-pressed': String(lane.key === selected),
          style: `left:${lane.left}%;width:${lane.width}%`, onClick: (event: Event) => {
            event.stopPropagation()
            onSelect(lane.key)
          }
        })))
  })
  const axis = h('div', { class: 'bg-tl-axis', 'aria-hidden': 'true' }, h('div', {}), h('div', { class: 'bg-tl-ticks' },
    ...timeline.ticks.map((tick) => h('span', { class: 'bg-tl-tick', style: `left:${tick.left}%` }, clock(tick.at)))))
  return h('section', { class: 'bg-tl', id: 'bg-timeline', 'aria-label': 'Agent timeline' }, axis, ...rows)
}
