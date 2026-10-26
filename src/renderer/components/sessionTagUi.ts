import { SESSION_TAGS, SESSION_TAG_LABELS, type SessionTag } from '../../shared/sessionTags'
import { h } from '../dom'
import './sessionTags.css'

export type TagSource = 'branch' | 'conversation' | null

export const tagTooltip = (tag: SessionTag, source: TagSource = null): string =>
  `Tag: ${SESSION_TAG_LABELS[tag]}${source ? ` (from the ${source === 'branch' ? 'branch' : 'conversation'})` : ''}`

export function tagChip(tag: SessionTag, compact = false, source: TagSource = null): HTMLElement {
  return h('span', { class: `tag-chip${compact ? ' compact' : ''}`, 'data-tag': tag, title: tagTooltip(tag, source) }, SESSION_TAG_LABELS[tag])
}

/** Menu entries to set or clear a session's tag; the caller closes its own menu in `pick`. */
export function tagMenuItems(current: SessionTag | null, pick: (tag: SessionTag | null) => void): HTMLElement[] {
  const items = SESSION_TAGS.map((tag) =>
    h(
      'button',
      { class: 'menu-item menu-item-tag', type: 'button', role: 'menuitemradio', 'aria-checked': String(tag === current), 'data-tag': tag, onClick: () => pick(tag) },
      h('span', { class: 'tag-dot', 'aria-hidden': 'true' }),
      `Tag as ${SESSION_TAG_LABELS[tag]}`,
      tag === current ? h('span', { class: 'tag-check', 'aria-hidden': 'true' }, '✓') : null
    )
  )
  if (current) items.push(h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onClick: () => pick(null) }, 'Remove tag'))
  return items
}
