import { SESSION_TAGS, SESSION_TAG_LABELS, type SessionTag } from '../../shared/sessionTags'
import { h } from '../dom'
import './sessionTags.css'

export function tagChip(tag: SessionTag, compact = false): HTMLElement {
  return h('span', { class: `tag-chip${compact ? ' compact' : ''}`, 'data-tag': tag, title: `Tag: ${SESSION_TAG_LABELS[tag]}` }, SESSION_TAG_LABELS[tag])
}

/** The sidebar's rows are narrow, so a tag there is a coloured dot with its name for assistive tech and the tooltip. */
export const tagDot = (tag: SessionTag): HTMLElement =>
  h('span', { class: 'tag-dot', 'data-tag': tag, role: 'img', 'aria-label': `Tag: ${SESSION_TAG_LABELS[tag]}`, title: `Tag: ${SESSION_TAG_LABELS[tag]}` })

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
