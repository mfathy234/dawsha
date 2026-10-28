import type { SectionId } from '../../shared/filesLayout'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { fileIcon } from './fileIcon'
import { filesLayout, updateLayout } from './filesPrefs'
import { FilesTree, type TreeHooks } from './filesTree'
import { SearchPanel, type SearchHooks } from './searchPanel'
import { ReviewPanel, type ReviewHooks } from './reviewPanel'

export type ExplorerMode = 'files' | 'search' | 'review'

export interface ChangeRow {
  path: string
  letter: string
}

export interface OpenRow {
  path: string
  sessions: string[]
}

export interface ExplorerHooks {
  tree: TreeHooks
  search: SearchHooks
  review: ReviewHooks
  goToFile(): void
  openLocation(button: HTMLElement): void
  rowMenu(path: string, x: number, y: number, returnFocus: HTMLElement): void
  openRow(path: string, pin: boolean): void
}

const BADGE_TITLES: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', U: 'New (untracked)', R: 'Renamed', C: 'Copied', T: 'Type changed', '!': 'Conflict' }

const split = (path: string): { name: string; folder: string } => {
  const cut = path.lastIndexOf('/')
  return { name: path.slice(cut + 1), folder: cut < 0 ? '' : path.slice(0, cut) }
}

/** The left column: the location button, the Files | Search | Review modes, and the foldable Changes / Open in sessions / tree sections. */
export class Explorer {
  readonly el = h('div', { class: 'files-tree-col' })
  readonly tree: FilesTree
  readonly search: SearchPanel
  readonly review: ReviewPanel
  private mode: ExplorerMode = 'files'
  private active: string | null = null
  private changes: ChangeRow[] = []
  private open: OpenRow[] = []
  private readonly projectLine = h('span', { class: 'files-loc-project' }, 'No project')
  private readonly branchLineEl = h('span', { class: 'files-loc-branch' })
  private readonly location = h('button', { class: 'files-location', type: 'button', id: 'files-location', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Project and checkout' },
    h('span', { class: 'files-loc-text' }, this.projectLine, this.branchLineEl), icon(ICONS.chevronDown))
  private readonly tabs = (['files', 'search', 'review'] as const).map((mode) => h('button', {
    class: 'files-mode', type: 'button', role: 'tab', id: `files-mode-${mode}`, 'aria-selected': 'false', tabindex: '-1', onClick: () => this.setMode(mode)
  }))
  private readonly tablist = h('div', { class: 'files-modes', role: 'tablist', 'aria-label': 'Explorer' }, ...this.tabs)
  private readonly goTo = h('button', { class: 'files-goto', type: 'button', id: 'files-goto', onClick: () => this.hooks.goToFile() },
    icon(ICONS.search), h('span', { class: 'files-goto-text' }, 'Go to file…'), h('span', { class: 'files-goto-keys' }, 'Ctrl+P'))
  private readonly changesBody = h('div', { class: 'files-sec-body', id: 'files-changes-list' })
  private readonly openBody = h('div', { class: 'files-sec-body', id: 'files-open-list' })
  private readonly treeTitle = h('span', { class: 'files-sec-title' }, 'Files')
  private readonly sections: Record<SectionId, { root: HTMLElement; head: HTMLButtonElement; count: HTMLElement }>
  private readonly filesPane = h('div', { class: 'files-pane files-pane-files', role: 'tabpanel', 'aria-labelledby': 'files-mode-files' })
  private reviewCount = 0

  constructor(private readonly hooks: ExplorerHooks) {
    this.tree = new FilesTree(hooks.tree)
    this.search = new SearchPanel(hooks.search)
    this.review = new ReviewPanel(hooks.review)
    this.search.el.setAttribute('role', 'tabpanel')
    this.search.el.setAttribute('aria-labelledby', 'files-mode-search')
    this.review.el.setAttribute('role', 'tabpanel')
    this.review.el.setAttribute('aria-labelledby', 'files-mode-review')
    this.sections = {
      changes: this.section('changes', 'Changes', this.changesBody),
      open: this.section('open', 'Open in sessions', this.openBody),
      tree: this.section('tree', '', this.tree.el, this.treeTitle)
    }
    this.filesPane.append(this.goTo, this.sections.changes.root, this.sections.open.root, this.sections.tree.root)
    this.location.addEventListener('click', () => hooks.openLocation(this.location))
    this.tablist.addEventListener('keydown', (event) => this.onTabKey(event))
    this.el.append(this.location, this.tablist, this.filesPane, this.search.el, this.review.el)
    this.renderTabs()
    this.renderChanges()
    this.renderOpen()
    this.applyMode()
  }

  private section(id: SectionId, title: string, body: HTMLElement, titleEl?: HTMLElement): { root: HTMLElement; head: HTMLButtonElement; count: HTMLElement } {
    const count = h('span', { class: 'files-sec-count' })
    const head = h('button', { class: 'files-sec-head', type: 'button', id: `files-sec-${id}`, 'aria-controls': `files-sec-body-${id}`, onClick: () => this.fold(id) },
      icon(ICONS.chevronRight), titleEl ?? h('span', { class: 'files-sec-title' }, title), count)
    body.id = body.id || `files-sec-body-${id}`
    const wrap = h('div', { class: 'files-sec-box', id: `files-sec-body-${id}` }, body)
    const root = h('section', { class: 'files-sec', 'data-section': id }, head, wrap)
    this.syncFold(id, head, wrap)
    return { root, head, count }
  }

  private syncFold(id: SectionId, head: HTMLElement, wrap: HTMLElement): void {
    const open = filesLayout().sections[id]
    head.setAttribute('aria-expanded', String(open))
    wrap.hidden = !open
  }

  private fold(id: SectionId): void {
    updateLayout((layout) => ({ ...layout, sections: { ...layout.sections, [id]: !layout.sections[id] } }))
    const { head } = this.sections[id]
    this.syncFold(id, head, head.nextElementSibling as HTMLElement)
  }

  setLocation(project: string, branch: string, title: string): void {
    this.projectLine.textContent = project || 'No project'
    this.branchLineEl.textContent = branch
    this.branchLineEl.hidden = branch === ''
    this.location.title = title
  }

  setLocationOpen(open: boolean): void {
    this.location.setAttribute('aria-expanded', String(open))
  }

  setTreeTitle(name: string): void {
    this.treeTitle.textContent = name || 'Files'
  }

  setActive(path: string | null): void {
    this.active = path
    this.tree.setActive(path)
    for (const row of this.el.querySelectorAll<HTMLElement>('.files-flat')) row.classList.toggle('active', row.dataset.path === path)
  }

  setChanges(rows: ChangeRow[]): void {
    this.changes = rows
    this.reviewCount = rows.length
    this.renderChanges()
    this.renderTabs()
  }

  setOpenInSessions(rows: OpenRow[]): void {
    this.open = rows
    this.renderOpen()
  }

  currentMode(): ExplorerMode {
    return this.mode
  }

  setMode(mode: ExplorerMode, focus = true): void {
    this.mode = mode
    this.applyMode()
    this.renderTabs()
    if (!focus) return
    if (mode === 'search') this.search.focus()
    else if (mode === 'review') this.review.focus()
  }

  private applyMode(): void {
    this.filesPane.hidden = this.mode !== 'files'
    this.search.el.hidden = this.mode !== 'search'
    this.review.el.hidden = this.mode !== 'review'
  }

  private renderTabs(): void {
    const labels = ['Files', 'Search', this.reviewCount > 0 ? `Review ${this.reviewCount}` : 'Review']
    this.tabs.forEach((tab, index) => {
      const selected = (['files', 'search', 'review'] as const)[index] === this.mode
      tab.textContent = labels[index]
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
    })
  }

  private onTabKey(event: KeyboardEvent): void {
    const modes = ['files', 'search', 'review'] as const
    const at = modes.indexOf(this.mode)
    const next = event.key === 'ArrowRight' ? (at + 1) % 3 : event.key === 'ArrowLeft' ? (at + 2) % 3 : -1
    if (next < 0) return
    event.preventDefault()
    this.setMode(modes[next], false)
    this.tabs[next].focus()
  }

  private flat(path: string, trailing: HTMLElement | null, menu = true): HTMLElement {
    const { name, folder } = split(path)
    const row = h('button', { class: `files-flat${path === this.active ? ' active' : ''}`, type: 'button', 'data-path': path, title: path,
      onClick: (event: Event) => this.hooks.openRow(path, (event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey),
      onDblclick: () => this.hooks.openRow(path, true) },
    fileIcon(path), h('span', { class: 'files-flat-name' }, name), folder ? h('span', { class: 'files-flat-dir' }, folder) : null, trailing)
    if (menu) row.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      this.hooks.rowMenu(path, event.clientX, event.clientY, row)
    })
    return row
  }

  private renderChanges(): void {
    this.sections.changes.count.textContent = this.changes.length > 0 ? String(this.changes.length) : ''
    this.sections.changes.head.setAttribute('aria-label', `Changes, ${this.changes.length}`)
    this.changesBody.replaceChildren(...(this.changes.length === 0
      ? [h('div', { class: 'files-empty' }, 'Nothing has changed yet.')]
      : this.changes.map((row) => this.flat(row.path, h('span', { class: `files-badge b-${row.letter === 'U' ? 'A' : row.letter}`, title: BADGE_TITLES[row.letter] ?? row.letter }, row.letter === 'U' ? 'A' : row.letter)))))
  }

  private renderOpen(): void {
    this.sections.open.count.textContent = this.open.length > 0 ? String(this.open.length) : ''
    this.sections.open.head.setAttribute('aria-label', `Open in sessions, ${this.open.length}`)
    this.openBody.replaceChildren(...(this.open.length === 0
      ? [h('div', { class: 'files-empty' }, 'No open session has edited a file yet.')]
      : this.open.map((row) => this.flat(row.path, h('span', { class: 'files-flat-who', title: row.sessions.join(', ') }, row.sessions.length > 1 ? `${row.sessions[0]} +${row.sessions.length - 1}` : row.sessions[0] ?? '')))))
  }

  focus(): void {
    this.tree.focus()
  }
}
