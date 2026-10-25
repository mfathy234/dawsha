import { closeWhatsNew, openUpdateLink, showFullChangelog } from '../actions'
import { entryToMarkdown, type ChangelogEntry } from '../../shared/changelog'
import { renderMarkdown } from '../../shared/markdown'
import { h } from '../dom'
import { addDismissButton } from './dialogs'
import type { AppState, WhatsNewView } from '../state'

export function entryBlock(entry: ChangelogEntry): HTMLElement {
  const body = h('div', { class: 'md' })
  body.innerHTML = renderMarkdown(entryToMarkdown(entry))
  return h(
    'section',
    { class: 'wn-entry', 'data-version': entry.version },
    h('h3', {}, entry.version, entry.date ? h('span', { class: 'wn-date' }, entry.date) : null),
    body
  )
}

export class WhatsNewComponent {
  private root: HTMLElement | null = null
  private view: WhatsNewView | null = null
  private previous: HTMLElement | null = null

  update(state: AppState): void {
    if (state.whatsNew && !this.root) this.open(state.whatsNew)
    if (!state.whatsNew && this.root) this.close()
  }

  private open(view: WhatsNewView): void {
    this.view = view
    this.previous = document.activeElement as HTMLElement | null
    this.root = h('div', { class: 'overlay whats-new-overlay' })
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeWhatsNew()
      }
    })
    this.root.addEventListener('mousedown', (event) => {
      if (event.target === this.root) closeWhatsNew()
    })
    this.root.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-link]')
      if (!link) return
      event.preventDefault()
      openUpdateLink(link.href)
    })
    document.body.appendChild(this.root)
    this.render(false)
  }

  private render(showOlder: boolean): void {
    if (!this.root || !this.view) return
    const [latest, ...older] = this.view.entries
    const got = h('button', { class: 'btn primary', type: 'button', id: 'wn-close', onClick: () => closeWhatsNew() }, 'Got it')
    const olderBlock =
      older.length === 0
        ? null
        : showOlder
          ? h('div', { class: 'wn-older', id: 'wn-older' }, ...older.map(entryBlock))
          : h('button', { class: 'btn ghost small', type: 'button', id: 'wn-show-older', onClick: () => this.render(true) }, 'Show older versions')
    const dialog = h(
      'div',
      { class: 'dialog whats-new', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wn-title' },
      h('h2', { id: 'wn-title' }, `What's new in Dawsha ${this.view.version}`),
      this.view.from ? h('p', { class: 'wn-from' }, `Updated from ${this.view.from}`) : null,
      h('div', { class: 'wn-body' }, latest ? entryBlock(latest) : h('p', {}, 'No release notes for this version.'), olderBlock),
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { class: 'btn ghost', type: 'button', id: 'wn-full', onClick: () => showFullChangelog() }, 'Full changelog'),
        got
      )
    )
    addDismissButton(dialog, () => closeWhatsNew())
    this.root.replaceChildren(dialog)
    if (showOlder) this.root.querySelector<HTMLElement>('#wn-older')?.scrollIntoView({ block: 'nearest' })
    else got.focus()
  }

  private close(): void {
    this.root?.remove()
    this.root = null
    this.view = null
    this.previous?.focus()
  }
}
