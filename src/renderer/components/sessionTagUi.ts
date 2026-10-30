import { SESSION_TAGS, SESSION_TAG_LABELS, type SessionTag } from '../../shared/sessionTags'
import { h } from '../dom'
import './sessionTags.css'

export type TagSource = 'branch' | 'conversation' | null

export const tagTooltip = (tag: SessionTag, source: TagSource = null): string =>
  `Tag: ${SESSION_TAG_LABELS[tag]}${source ? ` (from the ${source === 'branch' ? 'branch' : 'conversation'})` : ''}`

/** The tag as a quiet lowercase word in the tag's muted colour; the caller places it in a meta line. */
export function tagWord(tag: SessionTag, source: TagSource = null): HTMLElement {
  return h('span', { class: 'tag-word', 'data-tag': tag, title: tagTooltip(tag, source) }, SESSION_TAG_LABELS[tag].toLowerCase())
}

/** The tag as a small word on a sidebar session's meta line; its own class keeps `.tag-word` to the pane and board tags. */
export function sidebarTagWord(tag: SessionTag, source: TagSource = null): HTMLElement {
  return h('span', { class: 'sess-tag', 'data-tag': tag, title: tagTooltip(tag, source) }, SESSION_TAG_LABELS[tag].toLowerCase())
}

/** Menu entries to set or clear a session's tag; the caller closes its own menu in `pick`. */
export function tagMenuItems(current: SessionTag | null, pick: (tag: SessionTag | null) => void): HTMLElement[] {
  const items = SESSION_TAGS.map((tag) =>
    h(
      'button',
      { class: 'menu-item menu-item-tag', type: 'button', role: 'menuitemradio', 'aria-checked': String(tag === current), 'data-tag': tag, onClick: () => pick(tag) },
      'Tag as ',
      h('span', { class: 'tag-name' }, SESSION_TAG_LABELS[tag]),
      tag === current ? h('span', { class: 'tag-check', 'aria-hidden': 'true' }, '✓') : null
    )
  )
  if (current) items.push(h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onClick: () => pick(null) }, 'Remove tag'))
  return items
}
