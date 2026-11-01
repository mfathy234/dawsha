import { h, icon } from '../dom'
import { ICONS } from '../icons'

const minus = '−'

const arrow = (path: string): string => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
const ARROW_LEFT = arrow('<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>')
const ARROW_RIGHT = arrow('<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>')

export interface BarModel {
  path: string | null
  /** The file is open and can be switched between File and Changes. */
  canDiff: boolean
  changes: boolean
  added: number | null
  removed: number | null
  editing: boolean
  canPreview: boolean
  previewing: boolean
  /** The source can be shown (an image that is not text has none). */
  hasSource: boolean
  inspectorOpen: boolean
  inspectorFits: boolean
  explorerOpen: boolean
  deletedName: string | null
  canBack: boolean
  canForward: boolean
  /** The class and method the caret is in, outermost first. */
  symbols: readonly string[]
}

export interface BarHooks {
  showFile(): void
  showChanges(): void
  setPreview(on: boolean): void
  done(): void
  send(anchor: HTMLElement): void
  more(anchor: HTMLElement): void
  toggleInspector(): void
  toggleExplorer(): void
  back(): void
  forward(): void
  /** A symbol crumb was chosen: open Go to Symbol. */
  symbol(): void
}

/** The breadcrumb bar: the path, File | Changes, Preview | Source, Send to agent, the more menu and the inspector toggle. */
export class FilesBar {
  readonly el = h('div', { class: 'files-bar' })
  readonly crumb = h('div', { class: 'files-crumb', id: 'files-crumb', 'aria-label': 'File path' })
  private readonly fileButton = h('button', { class: 'files-seg', type: 'button', id: 'files-file', 'aria-pressed': 'true', onClick: () => this.hooks.showFile() }, 'File')
  private readonly changesButton = h('button', { class: 'files-seg', type: 'button', id: 'files-changes', 'aria-pressed': 'false', title: 'Show what changed since main (click again for the file)', onClick: () => this.hooks.showChanges() }, 'Changes')
  private readonly previewButton = h('button', { class: 'files-seg', type: 'button', id: 'files-view-preview', 'aria-pressed': 'true', onClick: () => this.hooks.setPreview(true) }, 'Preview')
  private readonly sourceButton = h('button', { class: 'files-seg', type: 'button', id: 'files-view-source', 'aria-pressed': 'false', onClick: () => this.hooks.setPreview(false) }, 'Source')
  private readonly diffSegment = h('div', { class: 'files-segment', role: 'group', 'aria-label': 'View' }, this.fileButton, this.changesButton)
  private readonly previewSegment = h('div', { class: 'files-segment', role: 'group', 'aria-label': 'Preview or source', hidden: true }, this.previewButton, this.sourceButton)
  private readonly done = h('button', { class: 'btn small', type: 'button', id: 'files-edit', hidden: true, 'aria-pressed': 'true', onClick: () => this.hooks.done() }, 'Done')
  private readonly send = h('button', { class: 'btn small', type: 'button', id: 'files-send', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: (event: Event) => this.hooks.send(event.currentTarget as HTMLElement) }, 'Send to agent', icon(ICONS.chevronDown))
  readonly more = h('button', { class: 'icon-btn files-more', type: 'button', id: 'files-more', 'aria-label': 'More actions', title: 'More actions', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: (event: Event) => this.hooks.more(event.currentTarget as HTMLElement) }, icon(ICONS.more))
  private readonly backButton = h('button', { class: 'files-nav', type: 'button', id: 'files-back', 'aria-label': 'Back', title: 'Back (Alt+Left)', disabled: true, onClick: () => this.hooks.back() }, icon(ARROW_LEFT))
  private readonly forwardButton = h('button', { class: 'files-nav', type: 'button', id: 'files-forward', 'aria-label': 'Forward', title: 'Forward (Alt+Right)', disabled: true, onClick: () => this.hooks.forward() }, icon(ARROW_RIGHT))
  private readonly explorer = h('button', { class: 'icon-btn files-explorer-toggle', type: 'button', id: 'files-explorer-toggle', 'aria-label': 'Show the file explorer', title: 'Show the file explorer (Ctrl+Alt+E)', hidden: true, onClick: () => this.hooks.toggleExplorer() }, icon(ICONS.layout))
  private readonly inspector = h('button', { class: 'icon-btn files-inspector-toggle', type: 'button', id: 'files-inspector-toggle', 'aria-controls': 'files-side', onClick: () => this.hooks.toggleInspector() }, icon(ICONS.layout))

  constructor(private readonly hooks: BarHooks) {
    this.el.append(this.explorer, this.backButton, this.forwardButton, this.crumb, h('span', { class: 'spacer' }), this.previewSegment, this.diffSegment, this.done, this.send, this.more, this.inspector)
  }

  focusInspector(): void {
    this.inspector.focus()
  }

  focusExplorer(): void {
    this.explorer.focus()
  }

  setMenuOpen(button: 'send' | 'more', open: boolean): void {
    ;(button === 'send' ? this.send : this.more).setAttribute('aria-expanded', String(open))
  }

  render(model: BarModel): void {
    this.explorer.hidden = model.explorerOpen
    this.backButton.disabled = !model.canBack
    this.forwardButton.disabled = !model.canForward
    const bare = model.path === null
    this.el.hidden = bare && model.explorerOpen && (model.inspectorOpen || !model.inspectorFits)
    this.inspector.hidden = !model.inspectorFits
    this.inspector.setAttribute('aria-pressed', String(model.inspectorOpen))
    const inspectorLabel = model.inspectorOpen ? 'Hide outline and activity' : 'Show outline and activity'
    this.inspector.setAttribute('aria-label', inspectorLabel)
    this.inspector.title = `${inspectorLabel} (Ctrl+Alt+B)`
    if (bare) {
      this.crumb.replaceChildren()
      for (const part of [this.backButton, this.forwardButton, this.previewSegment, this.diffSegment, this.done, this.send, this.more]) part.hidden = true
      return
    }
    const path = model.path as string
    const parts = path.split('/')
    this.crumb.replaceChildren(...parts.flatMap((part, index) => [
      ...(index > 0 ? [h('span', { class: 'files-crumb-sep', 'aria-hidden': 'true' }, '/')] : []),
      h('span', { class: index === parts.length - 1 ? 'files-crumb-leaf' : 'files-crumb-part' }, part)
    ]), ...model.symbols.flatMap((name) => [
      h('span', { class: 'files-crumb-sep', 'aria-hidden': 'true' }, '/'),
      h('button', { class: 'files-crumb-symbol', type: 'button', title: 'Go to symbol (Ctrl+Shift+O)', onClick: () => this.hooks.symbol() }, name)
    ]))
    this.crumb.title = path
    this.diffSegment.hidden = !model.canDiff
    this.fileButton.setAttribute('aria-pressed', String(!model.changes))
    this.changesButton.setAttribute('aria-pressed', String(model.changes))
    const stat = model.added !== null || model.removed !== null ? ` +${model.added ?? 0} ${minus}${model.removed ?? 0}` : ''
    this.changesButton.textContent = `Changes${stat}`
    this.previewSegment.hidden = !model.canPreview || !model.hasSource
    this.previewButton.setAttribute('aria-pressed', String(model.previewing))
    this.sourceButton.setAttribute('aria-pressed', String(!model.previewing))
    this.done.hidden = !model.editing
    this.backButton.hidden = false
    this.forwardButton.hidden = false
    this.send.hidden = false
    this.more.hidden = false
    this.fileButton.disabled = !model.canDiff
    this.changesButton.disabled = !model.canDiff
  }
}
