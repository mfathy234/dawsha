import { buildTree, filterTree, type StatusLetter, type TreeMode, type TreeNode } from '../../shared/fileTree'
import { treeClickPins } from '../../shared/fileOpenMode'
import { treeShortcut, type FileActionId } from '../../shared/fileMenus'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { fileIcon, folderIcon } from './fileIcon'
import { ancestorsOf, flattenTree, treeKey, type TreeRow } from './filesState'

const MAX_ROWS = 2000

const MODES: { mode: TreeMode; label: string; id: string }[] = [
  { mode: 'all', label: 'All', id: 'files-mode-all' },
  { mode: 'changed', label: 'Changed', id: 'files-mode-changed' },
  { mode: 'sessions', label: 'Open in sessions', id: 'files-mode-sessions' }
]

const BADGE_TITLES: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', U: 'New (untracked)', R: 'Renamed', C: 'Copied', T: 'Type changed', '!': 'Conflict' }

export interface TreeHooks {
  /** A file was chosen: pin is true for a double click. focus moves the cursor into the editor (Enter). */
  open(path: string, pin: boolean, focus: boolean): void
  /** A key the menu shows (Alt+Enter, Shift+Alt+C, …) was pressed on a row. */
  action(id: FileActionId, target: TreeTarget): void
  /** Right click, the Menu key or Shift+F10 on a row: x and y are where the menu opens. */
  menu(target: TreeTarget, x: number, y: number, returnFocus: HTMLElement): void
}

export interface TreeTarget {
  path: string
  kind: 'file' | 'folder'
  open: boolean
}

/** The left column: filter box, All / Changed / Open in sessions chips and the folder tree with M / A / D badges. */
export class FilesTree {
  readonly el: HTMLElement
  private readonly filter = h('input', {
    class: 'files-filter', id: 'files-filter', type: 'search', placeholder: 'Filter files…', 'aria-label': 'Filter files',
    onInput: (event: Event) => {
      if (!(event as InputEvent).isComposing) this.setQuery((event.target as HTMLInputElement).value)
    }
  })
  private readonly chips = MODES.map(({ mode, label, id }) => h('button', { class: 'files-chip', type: 'button', id, 'aria-pressed': 'false', onClick: () => this.setMode(mode) }, label))
  private readonly list = h('div', { class: 'files-tree', id: 'files-tree', role: 'tree', tabindex: '0', 'aria-label': 'Project files' })
  private nodes: TreeNode[] = []
  private status = new Map<string, StatusLetter>()
  private touched = new Set<string>()
  private mode: TreeMode = 'all'
  private query = ''
  private openFolders = new Set<string>()
  private rows: TreeRow[] = []
  private cursor: string | null = null
  private active: string | null = null
  private note = ''

  constructor(private readonly hooks: TreeHooks, head: HTMLElement) {
    this.el = h('div', { class: 'files-tree-col' }, head, h('div', { class: 'files-filter-row' }, this.filter), h('div', { class: 'files-chips', role: 'group', 'aria-label': 'Show' }, ...this.chips), this.list)
    this.list.addEventListener('keydown', (event) => this.onKey(event))
    this.list.addEventListener('click', (event) => this.onClick(event))
    this.list.addEventListener('contextmenu', (event) => this.onContext(event))
    this.list.addEventListener('dblclick', (event) => this.onClick(event, true))
    this.syncChips()
  }

  setData(files: string[], status: Map<string, StatusLetter>, note = ''): void {
    this.status = status
    this.nodes = buildTree(files, status)
    this.note = note
    this.render()
  }

  setLoading(loading: boolean): void {
    this.list.inert = loading
    this.list.setAttribute('aria-busy', String(loading))
  }

  setTouched(paths: Iterable<string>): void {
    this.touched = new Set(paths)
    if (this.mode === 'sessions') this.render()
    else this.syncChips()
  }

  /** Returns the saved fold state of this project's tree, so switching projects keeps each tree as it was. */
  adoptFolders(folders: Set<string>): void {
    this.openFolders = folders
  }

  setActive(path: string | null): void {
    this.active = path
    if (path) this.reveal(path)
    else this.render()
  }

  /** Opens the folders above a file and puts the cursor on it. */
  reveal(path: string): void {
    for (const folder of ancestorsOf(path)) this.openFolders.add(folder)
    this.cursor = path
    this.render()
    this.scrollToCursor()
  }

  focus(): void {
    this.list.focus()
  }

  focusFilter(): void {
    this.filter.focus()
    this.filter.select()
  }

  private setMode(mode: TreeMode): void {
    this.mode = mode
    this.syncChips()
    this.render()
  }

  private setQuery(query: string): void {
    this.query = query
    this.render()
  }

  private syncChips(): void {
    MODES.forEach(({ mode }, index) => {
      const count = mode === 'changed' ? this.status.size : mode === 'sessions' ? this.touched.size : null
      const chip = this.chips[index]
      chip.setAttribute('aria-pressed', String(this.mode === mode))
      chip.textContent = `${MODES[index].label}${count ? ` ${count}` : ''}`
    })
  }

  private isOpen = (path: string): boolean => this.mode !== 'all' || this.query.trim() !== '' || this.openFolders.has(path)

  private render(): void {
    this.syncChips()
    const visible = filterTree(this.nodes, this.mode, this.touched, this.query)
    this.rows = flattenTree(visible, this.isOpen)
    const shown = this.rows.slice(0, MAX_ROWS)
    const children = shown.map((row) => this.rowEl(row))
    if (this.rows.length > MAX_ROWS) children.push(h('div', { class: 'files-empty' }, `${this.rows.length - MAX_ROWS} more. Type in the filter to narrow it down.`))
    else if (shown.length === 0) children.push(h('div', { class: 'files-empty' }, this.emptyText()))
    this.list.replaceChildren(...children)
    this.list.removeAttribute('aria-activedescendant')
    const at = this.cursorRow()
    if (at) this.list.setAttribute('aria-activedescendant', this.idOf(at.node.path))
  }

  private emptyText(): string {
    if (this.note) return this.note
    if (this.mode === 'changed') return 'Nothing has changed yet.'
    if (this.mode === 'sessions') return 'No open session has edited a file yet.'
    return this.query ? 'No file matches.' : 'This project has no files.'
  }

  private idOf(path: string): string {
    return `files-row-${path.replace(/[^A-Za-z0-9_-]/g, '_')}`
  }

  private cursorRow(): TreeRow | undefined {
    return this.rows.find((row) => row.node.path === this.cursor) ?? this.rows.find((row) => row.node.path === this.active)
  }

  private rowEl({ node, depth }: TreeRow): HTMLElement {
    const folder = node.kind === 'folder'
    const open = folder && this.isOpen(node.path)
    const letter = node.status
    const classes = ['files-row', folder ? 'folder' : 'file']
    if (node.path === this.active) classes.push('active')
    if (node.path === this.cursor) classes.push('cursor')
    if (letter === 'D') classes.push('deleted')
    return h('div', {
      class: classes.join(' '), id: this.idOf(node.path), role: 'treeitem', 'data-path': node.path, 'data-kind': node.kind,
      'aria-level': depth + 1, 'aria-selected': String(node.path === this.active), 'aria-expanded': folder ? String(open) : undefined,
      style: `padding-left:${8 + depth * 14}px`
    },
    folder ? h('span', { class: `files-twist${open ? ' open' : ''}`, 'aria-hidden': 'true' }, icon(ICONS.chevronRight)) : h('span', { class: 'files-twist none', 'aria-hidden': 'true' }),
    folder ? folderIcon(open) : fileIcon(node.path),
    h('span', { class: 'files-name' }, node.name),
    folder
      ? (node.changed > 0 ? h('span', { class: 'files-count', title: `${node.changed} changed` }, String(node.changed)) : null)
      : (letter ? h('span', { class: `files-badge b-${letter === 'U' ? 'A' : letter}`, title: BADGE_TITLES[letter] ?? letter }, letter === 'U' ? 'A' : letter) : null))
  }

  private scrollToCursor(): void {
    const at = this.cursorRow()
    if (at) this.list.querySelector(`[id="${this.idOf(at.node.path)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  private setCursor(path: string): void {
    this.cursor = path
    this.render()
    this.scrollToCursor()
  }

  private onClick(event: Event, pin = false): void {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.files-row')
    const path = row?.dataset.path
    if (!row || !path) return
    this.cursor = path
    if (row.dataset.kind === 'folder') {
      if (pin || (event as MouseEvent).detail > 1) return
      this.toggle(path, !this.isOpen(path))
      return
    }
    this.list.focus()
    this.hooks.open(path, pin || treeClickPins(event as MouseEvent), false)
    this.render()
  }

  private targetOf(path: string): TreeTarget | null {
    const row = this.rows.find((candidate) => candidate.node.path === path)
    return row ? { path, kind: row.node.kind, open: row.node.kind === 'folder' && this.isOpen(path) } : null
  }

  toggleFolder(path: string): void {
    this.toggle(path, !this.isOpen(path))
  }

  private onContext(event: MouseEvent): void {
    const path = (event.target as HTMLElement).closest<HTMLElement>('.files-row')?.dataset.path
    const target = path ? this.targetOf(path) : null
    if (!path || !target) return
    event.preventDefault()
    this.cursor = path
    this.render()
    this.hooks.menu(target, event.clientX, event.clientY, this.list)
  }

  private menuFromKeyboard(): void {
    const row = this.cursorRow()
    const target = row ? this.targetOf(row.node.path) : null
    const el = row ? this.list.querySelector<HTMLElement>(`[id="${this.idOf(row.node.path)}"]`) : null
    if (!target || !el) return
    const box = el.getBoundingClientRect()
    this.hooks.menu(target, box.left + 24, box.bottom, this.list)
  }

  private toggle(path: string, open: boolean): void {
    if (open) this.openFolders.add(path)
    else this.openFolders.delete(path)
    this.render()
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault()
      event.stopPropagation()
      this.menuFromKeyboard()
      return
    }
    const shortcut = treeShortcut(event)
    const at = shortcut ? this.cursorRow() : undefined
    const target = at ? this.targetOf(at.node.path) : null
    if (shortcut && target) {
      event.preventDefault()
      event.stopPropagation()
      this.hooks.action(shortcut, target)
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const current = this.cursorRow()
    const index = current ? this.rows.indexOf(current) : 0
    const result = treeKey(this.rows, index, event.key, this.isOpen)
    if (!result) return
    event.preventDefault()
    event.stopPropagation()
    if (result.kind === 'move') this.setCursor(this.rows[result.index].node.path)
    else if (result.kind === 'toggle') this.toggle(result.path, result.open)
    else this.hooks.open(result.path, event.key === 'Enter', event.key === 'Enter')
  }
}
