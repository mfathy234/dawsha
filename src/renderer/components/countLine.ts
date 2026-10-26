import { h } from '../dom'

export interface CountPart {
  id: string
  count: number
  one: string
  many: string
}

/** A summary as one quiet line: "2 conversations · 0 features · 6 total". Each part keeps its id for tests and links. */
export function countLine(parts: readonly CountPart[], label: string): HTMLElement {
  const line = h('p', { class: 'count-line', role: 'group', 'aria-label': label })
  parts.forEach((part, index) => {
    if (index > 0) line.append(h('span', { class: 'count-sep', 'aria-hidden': 'true' }, '·'))
    line.append(h('span', { class: 'count-part', id: part.id }, h('span', { class: 'count-value' }, String(part.count)), ` ${part.count === 1 ? part.one : part.many}`))
  })
  return line
}
