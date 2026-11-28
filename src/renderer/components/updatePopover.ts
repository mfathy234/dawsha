import { openUpdateLink, runUpdateAction, toggleUpdatePopover } from '../actions'
import { RELEASE_LATEST_URL, releaseTagUrl, renderMarkdown } from '../../shared/markdown'
import { h, leave } from '../dom'
import type { AppState } from '../state'
import type { UpdateState } from '../../shared/updates'
import { popupDismissButton } from './popupDismiss'

const BACKGROUND_NOTE = 'Downloads in the background. Your sessions keep running until you restart.'
const RESTART_NOTE = 'Open sessions reopen after the restart'
const PORTABLE_NOTE = ". The portable version can't update itself."
const POPOVER_WIDTH = 420

function releasedOn(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return ` · released ${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
}

export class UpdatePopoverComponent {
  private root: HTMLElement | null = null
  private signature = ''

  constructor(private readonly anchor: () => HTMLElement) {}

  update(state: AppState): void {
    if (state.updatePopoverOpen && !this.root) this.open()
    if (!state.updatePopoverOpen && this.root) this.close()
    if (this.root) this.render(state.update)
  }

  private open(): void {
    this.root = h('div', { class: 'popover update-popover', role: 'dialog', 'aria-label': 'Update' })
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        toggleUpdatePopover(false)
      }
    })
    this.root.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-link]')
      if (!link) return
      event.preventDefault()
      openUpdateLink(link.href)
    })
    document.body.appendChild(this.root)
    this.place()
    document.addEventListener('pointerdown', this.outside, true)
    this.signature = ''
  }

  private readonly outside = (event: Event): void => {
    const target = event.target as Node
    if (this.root && !this.root.contains(target) && !this.anchor().contains(target)) toggleUpdatePopover(false)
  }

  /**
   * Below the button in the top bar. A button near the bottom of the window (the sidebar rail) gets the popover beside it,
   * bottom-aligned, so it never runs off the screen. Sizes come from offsetHeight: the open animation scales the box.
   */
  private place(): void {
    if (!this.root) return
    const rect = this.anchor().getBoundingClientRect()
    const height = this.root.offsetHeight
    const fitsBelow = rect.bottom + 6 + height <= window.innerHeight - 8
    const besideRail = !fitsBelow && rect.right < window.innerWidth / 3
    const left = besideRail ? rect.right + 8 : Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 16))
    const top = fitsBelow ? rect.bottom + 6 : besideRail ? rect.bottom - height : rect.top - 6 - height
    this.root.style.left = `${Math.round(left)}px`
    this.root.style.top = `${Math.round(Math.max(8, Math.min(top, window.innerHeight - height - 8)))}px`
  }

  private close(): void {
    document.removeEventListener('pointerdown', this.outside, true)
    leave(this.root)
    this.root = null
  }

  private render(update: UpdateState): void {
    if (!this.root) return
    const signature = JSON.stringify([update.status, update.mode, update.version, Math.round(update.percent), update.error, update.notes])
    if (signature === this.signature) return
    this.signature = signature
    const hadFocus = this.root.contains(document.activeElement)
    this.root.replaceChildren(popupDismissButton(() => toggleUpdatePopover(false), 'popup-x-corner'), ...this.content(update))
    this.place()
    if (!hadFocus) this.root.querySelector<HTMLElement>('.btn')?.focus()
  }

  private button(id: string, label: string, onClick: () => void, primary = false): HTMLElement {
    return h('button', { class: `btn small ${primary ? 'primary' : 'ghost'}`, type: 'button', id, onClick }, label)
  }

  private notes(update: UpdateState): HTMLElement | null {
    if (!update.notes) return null
    const notes = h('div', { class: 'md update-notes', id: 'update-notes' })
    notes.innerHTML = renderMarkdown(update.notes)
    return notes
  }

  private content(update: UpdateState): HTMLElement[] {
    const version = update.version ?? ''
    if (update.status === 'downloading') {
      return [
        h('h2', { class: 'update-title' }, `Downloading Dawsha ${version}`),
        h('p', { class: 'update-sub', id: 'update-percent' }, `${Math.round(update.percent)}%`),
        h('p', { class: 'hint' }, BACKGROUND_NOTE)
      ]
    }
    if (update.status === 'ready') {
      return [
        h('h2', { class: 'update-title' }, `Dawsha ${version} is ready. Restart now, or it installs when you quit.`),
        h(
          'div',
          { class: 'update-actions' },
          this.button('update-restart', 'Restart now', () => void runUpdateAction('restart'), true),
          this.button('update-quit', 'When I quit', () => void runUpdateAction('dismiss'))
        ),
        h('p', { class: 'hint' }, RESTART_NOTE)
      ]
    }
    if (update.status === 'error') {
      return [
        h('h2', { class: 'update-title' }, 'Update failed'),
        h('p', { class: 'update-error', id: 'update-error', role: 'alert' }, update.error ?? 'The update could not be completed.'),
        h(
          'div',
          { class: 'update-actions' },
          this.button('update-retry', 'Try again', () => void runUpdateAction('retry'), true),
          this.button('update-github', 'Open GitHub', () => openUpdateLink(RELEASE_LATEST_URL))
        )
      ]
    }
    const portable = update.mode === 'portable'
    const later = this.button('update-later', 'Later', () => void runUpdateAction('dismiss'))
    const nodes: Array<HTMLElement | null> = [
      h('h2', { class: 'update-title' }, `Dawsha ${version} is available${portable ? PORTABLE_NOTE : ''}`),
      h('p', { class: 'update-sub' }, `You have ${update.currentVersion}${releasedOn(update.releaseDate)}`),
      this.notes(update),
      portable
        ? h('div', { class: 'update-actions' }, this.button('update-download-github', 'Download from GitHub', () => openUpdateLink(releaseTagUrl(version)), true), later)
        : h('div', { class: 'update-actions' }, this.button('update-now', 'Update now', () => void runUpdateAction('download'), true), later),
      portable ? null : h('p', { class: 'hint' }, BACKGROUND_NOTE),
      portable ? null : h('a', { class: 'update-link', id: 'update-view', href: releaseTagUrl(version), 'data-link': true }, 'View on GitHub')
    ]
    return nodes.filter((node): node is HTMLElement => node !== null)
  }
}
