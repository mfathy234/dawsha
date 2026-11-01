import { AGENT_NAMES } from '../../shared/agents'
import type { LimitsPillModel, PillAgent } from '../../shared/limitsPill'
import type { RingSpec } from '../../shared/limitRings'
import { h } from '../dom'
import { agentMark } from './agentMark'

const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The ring as SVG: a faint track, the arc for the used share, and the letters in the middle when the ring is lettered. */
export function ringSvg(spec: RingSpec): string {
  const { size, center, radius, strokeWidth, circumference, dashOffset } = spec.geometry
  const circle = (cls: string, extra = ''): string =>
    `<circle class="${cls}" cx="${center}" cy="${center}" r="${radius}" fill="none" stroke-width="${strokeWidth}"${extra}/>`
  const arc = circle('ring-arc', ` stroke-linecap="round" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${dashOffset.toFixed(2)}" transform="rotate(-90 ${center} ${center})"`)
  const letters = spec.lettered ? `<text class="ring-text" x="${center}" y="${center}" text-anchor="middle" dominant-baseline="central">${escapeText(spec.letter)}</text>` : ''
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false">${circle('ring-track')}${arc}${letters}</svg>`
}

export function ringElement(spec: RingSpec): HTMLElement {
  const ring = h('span', {
    class: `limit-ring stage-${spec.stage}${spec.lettered ? '' : ' plain'}`,
    title: spec.title,
    'data-limit': spec.window.key,
    'data-percent': String(Math.round(spec.window.percent))
  })
  ring.innerHTML = ringSvg(spec)
  return ring
}

function agentGroup(item: PillAgent): HTMLElement {
  return h(
    'span',
    { class: `limits-agent${item.stale ? ' stale' : ''}`, 'data-agent': item.agent },
    agentMark(item.agent),
    h('span', { class: 'limit-rings' }, ...item.rings.map(ringElement))
  )
}

/** The children of the limits pill for a model: one group per agent with data, or the "no limits reported" state. */
export function limitsPillChildren(model: LimitsPillModel): Node[] {
  if (model.agents.length === 0 && model.empty) {
    return [h('span', { class: 'limits-agent', 'data-agent': model.empty }, agentMark(model.empty), h('span', { class: 'limits-agent-name' }, AGENT_NAMES[model.empty])), h('span', { class: 'limits-none' }, 'no limits reported')]
  }
  return model.agents.map(agentGroup)
}
