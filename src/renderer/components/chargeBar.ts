import { gaugeStage } from '../../shared/statusLine'
import { h } from '../dom'

export const CHARGE_CELLS = 10

// A small battery: ten cells filled to the share used, coloured by the same stages as the text gauges.
export function chargeBar(percent: number, cells = CHARGE_CELLS): HTMLElement {
  const filled = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))
  const bar = h('span', { class: `charge stage-${gaugeStage(percent)}`, 'aria-hidden': 'true', 'data-filled': String(filled) })
  for (let index = 0; index < cells; index++) bar.append(h('i', { class: index < filled ? 'on' : '' }))
  return bar
}
