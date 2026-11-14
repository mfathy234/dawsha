import { SESSION_NAME_MAX, SESSION_TAGS, SESSION_TAG_LABELS, type SessionTag } from '../../shared/sessionTags'
import type { KeptSession } from '../../shared/types'
import { h } from '../dom'
import type { ContextEntry } from './contextMenu'

export interface ClosedRowActions {
  rename: () => void
  copyName: () => void
  tag: (tag: SessionTag | null) => void
  remove: () => void
}

/** The menu behind a closed row's ⋯ button and its right click. */
export function closedMenuEntries(kept: KeptSession, actions: ClosedRowActions): ContextEntry[] {
  const tags: ContextEntry[] = SESSION_TAGS.map((tag) => ({ label: `Tag as ${SESSION_TAG_LABELS[tag]}`, current: tag === kept.tag, run: () => actions.tag(tag) }))
  if (kept.tag) tags.push({ label: 'Remove tag', run: () => actions.tag(null) })
  return [{ label: 'Rename', keys: 'F2', run: actions.rename }, { label: 'Copy session name', run: actions.copyName }, 'separator', ...tags, 'separator', { label: 'Remove from list', keys: 'Del', run: actions.remove }]
}

/** The name typed inline in a row: Enter keeps it, Esc drops the edit, leaving the field keeps it. `done` runs once. */
export function renameField(title: string, done: (name: string | null) => void): HTMLInputElement {
  let finished = false
  const finish = (name: string | null): void => {
    if (finished) return
    finished = true
    done(name)
  }
  const input = h('input', { class: 'text-input rp-rename', type: 'text', dir: 'auto', maxlength: Math.max(SESSION_NAME_MAX, title.length), value: title, 'aria-label': `Rename ${title}`, autocomplete: 'off', spellcheck: false })
  const startingValue = input.value
  input.addEventListener('click', (event) => event.stopPropagation())
  input.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      finish(input.value === startingValue ? null : input.value)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      finish(null)
    }
  })
  input.addEventListener('blur', () => finish(input.value === startingValue ? null : input.value))
  return input
}
