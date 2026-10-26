import { statusLetter } from '../../shared/gitStatus'
import { normalizeFolder } from '../../shared/folderKey'
import { languageLabel } from '../files/languages'
import { api } from '../api'
import { focusPane, saveSettings } from '../actions'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { currentBundle, onThemeChange } from '../themeManager'
import { projectById, store, type AppState } from '../state'
import { FileDoc, type DocHooks } from '../files/fileDoc'
import { noteOpened } from '../files/fileIndex'
import { addToPrompt, filesTarget, onFilesRequest, openInVsCode, setCurrentTarget, takeFilesRequest, type FilesTarget } from '../files/filesActions'
import { closeTab, openTab, pinTab, type TabRef } from '../files/filesState'
import { FilesTree } from '../files/filesTree'
import { loadTouches, type TouchMap } from '../files/sessionTouch'
import type { CursorInfo, EditorTheme } from '../files/editor'
import type { OutlineItem } from '../files/outline'
import { confirmDialog } from './dialogs'
import { selectMenu, syncSelectMenu } from './selectMenu'
import { toast } from './toast'
import './filesView.css'

const TOUCH_REFRESH_MS = 8000
const WATCH_DEBOUNCE_MS = 150
const FLASH_MS = 1600

interface DocSet {
  projectId: string
  folder: string
  docs: Map<string, FileDoc>
  tabs: TabRef[]
  active: string | null
  openFolders: Set<string>
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const themeKind = (): EditorTheme => (currentBundle().theme.kind === 'light' ? 'light' : 'dark')
const minus = '−'

export class FilesViewComponent {
  readonly el = h('main', { class: 'files-view', id: 'files-view', 'aria-label': 'Files' })
  private visible = false
  private target: FilesTarget | null = null
  private readonly sets = new Map<string, DocSet>()
  private set: DocSet | null = null
  private touches: TouchMap = new Map()
  private touchTimer: number | undefined
  private treeToken = 0
  private watchTimer: number | undefined
  private flashTimer: number | undefined
  private flash = ''
  private cursorText = ''
  private readonly lastSignature = new WeakMap<FileDoc, string>()
  private projectSignature = ''

  private readonly projectSelect = h('select', { id: 'files-project', 'aria-label': 'Project', onChange: (event: Event) => this.switchProject((event.target as HTMLSelectElement).value) })
  private readonly worktreeNote = h('div', { class: 'files-worktree', hidden: true })
  private readonly tree = new FilesTree({ open: (path, pin, focus) => void this.openFile(path, { pin, focus }) }, h('div', { class: 'files-switcher' }, selectMenu(this.projectSelect), this.worktreeNote))
  private readonly tabs = h('div', { class: 'files-tabs', role: 'tablist', 'aria-label': 'Open files' })
  private readonly crumb = h('div', { class: 'files-crumb', 'aria-label': 'File path' })
  private readonly fileButton = h('button', { class: 'files-seg', type: 'button', id: 'files-file', 'aria-pressed': 'true', onClick: () => void this.showFileMode() }, 'File')
  private readonly changesButton = h('button', { class: 'files-seg', type: 'button', id: 'files-changes', 'aria-pressed': 'false', title: 'Show what changed since main (click again for the file)', onClick: () => void this.toggleChanges() }, 'Changes')
  private readonly editButton = h('button', { class: 'btn ghost small', type: 'button', id: 'files-edit', onClick: () => this.toggleEdit() }, 'Edit')
  private readonly promptButton = h('button', { class: 'btn ghost small', type: 'button', id: 'files-add-prompt', title: 'Type @path (and the selected lines) into the focused session', onClick: () => this.addActiveToPrompt() }, 'Add to prompt')
  private readonly codeButton = h('button', { class: 'btn ghost small', type: 'button', id: 'files-open-code', onClick: () => this.openActiveInCode() }, icon(ICONS.code), 'Open in VS Code')
  private readonly copyButton = h('button', { class: 'icon-btn', type: 'button', id: 'files-copy-path', 'aria-label': 'Copy path', title: 'Copy path', onClick: () => void this.copyPath() }, icon(ICONS.copy))
  private readonly bar = h('div', { class: 'files-bar' })
  private readonly conflict = h('div', { class: 'files-conflict', id: 'files-conflict', role: 'alert', hidden: true },
    h('span', { class: 'files-conflict-text' }, 'This file changed on disk.'),
    h('button', { class: 'btn small', type: 'button', id: 'files-reload-theirs', onClick: () => void this.active()?.reload() }, 'Reload theirs'),
    h('button', { class: 'btn small', type: 'button', id: 'files-keep-mine', onClick: () => void this.active()?.overwrite() }, 'Keep mine (overwrite)'))
  private readonly stage = h('div', { class: 'files-stage' })
  private readonly empty = h('div', { class: 'files-placeholder', id: 'files-empty' })
  private readonly status = h('div', { class: 'files-status', id: 'files-status' })
  private readonly side = h('aside', { class: 'files-side', 'aria-label': 'About this file' })
  private readonly sessionsList = h('div', { class: 'files-side-list', id: 'files-sessions' })
  private readonly outlineList = h('div', { class: 'files-side-list', id: 'files-outline' })

  constructor() {
    this.bar.append(this.crumb, h('span', { class: 'spacer' }), h('div', { class: 'files-segment', role: 'group', 'aria-label': 'View' }, this.fileButton, this.changesButton), this.editButton, this.promptButton, this.codeButton, this.copyButton)
    this.stage.append(this.empty)
    this.side.append(
      h('section', { class: 'files-side-sec' }, h('h2', {}, 'Sessions that touched it'), this.sessionsList),
      h('section', { class: 'files-side-sec grow' }, h('h2', {}, 'Outline'), this.outlineList))
    this.el.append(this.tree.el, h('div', { class: 'files-main' }, this.tabs, this.bar, this.conflict, this.stage, this.status), this.side)
    this.el.addEventListener('keydown', (event) => this.onKey(event))
    api.onFilesChanged((key, paths) => this.onDiskChange(key, paths))
    onThemeChange(() => {
      for (const set of this.sets.values()) for (const doc of set.docs.values()) doc.setTheme(themeKind())
    })
    onFilesRequest(() => this.takeRequest())
  }

  update(state: AppState): void {
    const visible = state.view === 'files'
    if (visible && !this.visible) this.show(state)
    else if (!visible && this.visible) this.hide()
    if (visible) this.syncProjects(state)
  }

  private readonly hooks: DocHooks = {
    theme: themeKind,
    isChanged: (path) => this.tree.statusOf(path) !== undefined,
    changed: (doc) => this.docChanged(doc),
    edited: (doc) => this.pin(doc.path),
    cursor: (doc, info) => this.cursorMoved(doc, info),
    outlineChanged: (doc) => {
      if (doc === this.active()) this.renderOutline()
    }
  }

  // Showing and hiding

  private show(state: AppState): void {
    this.visible = true
    const request = takeFilesRequest()
    const target = request ?? filesTarget(state)
    if (!target) {
      this.target = null
      this.set = null
      this.renderAll()
      return
    }
    this.activateTarget(target)
    if (request) void this.openFile(request.path, { pin: request.pin, focus: true, line: request.line })
    void this.refreshTouches()
    this.touchTimer = window.setInterval(() => void this.refreshTouches(), TOUCH_REFRESH_MS)
  }

  private hide(): void {
    this.visible = false
    window.clearInterval(this.touchTimer)
    window.clearTimeout(this.watchTimer)
    if (this.target) void api.unwatchFiles(this.target.folder)
    this.target = null
    setCurrentTarget(null)
  }

  private takeRequest(): void {
    if (!this.visible) return
    const request = takeFilesRequest()
    if (!request) return
    if (!this.target || normalizeFolder(this.target.folder) !== normalizeFolder(request.folder) || this.target.projectId !== request.projectId) this.activateTarget(request)
    void this.openFile(request.path, { pin: request.pin, focus: true, line: request.line })
  }

  private activateTarget(target: FilesTarget): void {
    if (this.target && normalizeFolder(this.target.folder) !== normalizeFolder(target.folder)) void api.unwatchFiles(this.target.folder)
    const same = this.target !== null && normalizeFolder(this.target.folder) === normalizeFolder(target.folder)
    this.target = target
    setCurrentTarget(target)
    const key = `${target.projectId}|${normalizeFolder(target.folder)}`
    let set = this.sets.get(key)
    if (!set) {
      const saved = store.state.settings.filesTabs[target.projectId] ?? []
      set = { projectId: target.projectId, folder: target.folder, docs: new Map(), tabs: saved.map((path) => ({ path, pinned: true })), active: saved[0] ?? null, openFolders: new Set() }
      this.sets.set(key, set)
    }
    this.set = set
    this.tree.adoptFolders(set.openFolders)
    if (!same) void api.watchFiles(target.folder)
    this.touches = new Map()
    void this.loadTree()
    this.renderAll()
    const active = this.active()
    if (active) void this.loadActive(active)
  }

  private switchProject(projectId: string): void {
    const project = projectById(store.state, projectId)
    if (!project || !this.visible) return
    this.activateTarget({ projectId, folder: project.folder })
    void this.refreshTouches()
  }

  private syncProjects(state: AppState): void {
    const projects = state.settings.projects
    const signature = JSON.stringify(projects.map((p) => [p.id, p.name]))
    if (signature !== this.projectSignature) {
      this.projectSignature = signature
      this.projectSelect.replaceChildren(...projects.map((project) => h('option', { value: project.id }, project.name)))
    }
    if (this.target) this.projectSelect.value = this.target.projectId
    syncSelectMenu(this.projectSelect)
    const project = this.target ? projectById(state, this.target.projectId) : undefined
    const tail = this.target && project && normalizeFolder(project.folder) !== normalizeFolder(this.target.folder) ? this.target.folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : null
    this.worktreeNote.hidden = !tail
    this.worktreeNote.textContent = tail ? `Worktree: ${tail}` : ''
  }

  // Data

  private async loadTree(): Promise<void> {
    const target = this.target
    if (!target) return
    const token = ++this.treeToken
    const [listing, git] = await Promise.all([
      api.projectFiles(target.folder).catch((error: Error) => ({ ok: false as const, error: error.message })),
      api.gitStatus(target.folder).catch(() => null)
    ])
    if (token !== this.treeToken) return
    const status = new Map<string, string>()
    if (git?.ok) for (const file of git.status.files) status.set(file.path, statusLetter(file))
    this.tree.setData(listing.ok ? listing.files : [], status, listing.ok ? '' : listing.error)
    const set = this.set
    if (set) {
      this.tree.setActive(set.active)
      for (const doc of set.docs.values()) void doc.refreshStat()
    }
  }

  private async refreshTouches(): Promise<void> {
    const target = this.target
    if (!target) return
    const touches = await loadTouches(target.projectId, target.folder).catch(() => new Map() as TouchMap)
    if (this.target !== target) return
    this.touches = touches
    this.tree.setTouched(touches.keys())
    this.renderSessions()
  }

  private onDiskChange(key: string, paths: string[]): void {
    if (!this.visible || !this.target || normalizeFolder(this.target.folder) !== key) return
    window.clearTimeout(this.watchTimer)
    this.watchTimer = window.setTimeout(() => {
      void this.loadTree()
      const set = this.set
      if (!set) return
      for (const doc of set.docs.values()) if (paths.length === 0 || paths.includes(doc.path)) void doc.checkDisk()
    }, WATCH_DEBOUNCE_MS)
  }

  // Tabs and documents

  private active(): FileDoc | null {
    const set = this.set
    return set?.active ? set.docs.get(set.active) ?? null : null
  }

  private docFor(path: string): FileDoc | null {
    const set = this.set
    if (!set) return null
    let doc = set.docs.get(path)
    if (!doc) {
      doc = new FileDoc(set.folder, path, this.hooks)
      set.docs.set(path, doc)
      this.stage.append(doc.host)
    }
    return doc
  }

  private protectedPaths(set: DocSet): Set<string> {
    return new Set([...set.docs.values()].filter((doc) => doc.dirty).map((doc) => doc.path))
  }

  async openFile(path: string, options: { pin?: boolean; focus?: boolean; line?: number } = {}): Promise<void> {
    const set = this.set
    if (!set) return
    const result = openTab(set.tabs, path, options.pin === true, set.active, this.protectedPaths(set))
    if (!result) {
      toast('Close a tab first: every open file has unsaved changes.', 'info')
      return
    }
    const kept = new Set(result.tabs.map((tab) => tab.path))
    for (const [known, doc] of set.docs) {
      if (kept.has(known) || doc.dirty) continue
      doc.destroy()
      set.docs.delete(known)
    }
    set.tabs = result.tabs
    set.active = path
    const doc = this.docFor(path)
    noteOpened(set.folder, path)
    this.persistTabs()
    this.tree.setActive(path)
    this.renderAll()
    if (!doc) return
    await this.loadActive(doc)
    if (set.active !== path) return
    if (options.line && doc.editor) doc.editor.reveal(doc.editor.view.state.doc.line(Math.min(options.line, doc.editor.view.state.doc.lines)).from)
    if (options.focus) doc.editor?.focus()
  }

  private async loadActive(doc: FileDoc): Promise<void> {
    await doc.ensureLoaded()
    this.renderAll()
  }

  private pin(path: string): void {
    const set = this.set
    if (!set) return
    set.tabs = pinTab(set.tabs, path)
    this.persistTabs()
    this.renderTabs()
  }

  private async closeFile(path: string): Promise<void> {
    const set = this.set
    if (!set) return
    const doc = set.docs.get(path)
    if (doc?.dirty) {
      const name = baseName(path)
      const confirmed = await confirmDialog({ title: `Close ${name}?`, body: `${path} has changes that are not saved. Closing it discards them.`, confirmLabel: `Discard changes to ${name}` })
      if (!confirmed) return
    }
    const next = closeTab(set.tabs, set.active, path)
    set.tabs = next.tabs
    set.active = next.active
    doc?.destroy()
    set.docs.delete(path)
    this.persistTabs()
    this.tree.setActive(set.active)
    const active = this.active() ?? (set.active ? this.docFor(set.active) : null)
    this.renderAll()
    if (active) await this.loadActive(active)
  }

  private activate(path: string): void {
    const set = this.set
    if (!set || set.active === path) return
    set.active = path
    const doc = this.docFor(path)
    this.tree.setActive(path)
    this.renderAll()
    if (doc) void this.loadActive(doc).then(() => doc.editor?.focus())
  }

  private persistTabs(): void {
    const set = this.set
    if (!set) return
    const filesTabs = { ...store.state.settings.filesTabs }
    const paths = set.tabs.map((tab) => tab.path)
    if (paths.length === 0) delete filesTabs[set.projectId]
    else filesTabs[set.projectId] = paths
    if (JSON.stringify(filesTabs) === JSON.stringify(store.state.settings.filesTabs)) return
    store.set((s) => ({ ...s, settings: { ...s.settings, filesTabs } }))
    void saveSettings({ filesTabs })
  }

  // Actions on the active file

  private async toggleChanges(): Promise<void> {
    await this.active()?.toggleChanges()
  }

  private async showFileMode(): Promise<void> {
    const doc = this.active()
    if (doc?.changes) await doc.toggleChanges()
    doc?.editor?.focus()
  }

  private async toggleEdit(): Promise<void> {
    const doc = this.active()
    if (!doc) return
    if (doc.editing) {
      doc.stopEdit()
      return
    }
    if (doc.changes) await doc.toggleChanges()
    doc.startEdit()
  }

  private async save(): Promise<void> {
    const doc = this.active()
    if (!doc || !doc.dirty) return
    const outcome = await doc.save()
    if (outcome === 'saved') this.setFlash('Saved')
  }

  private setFlash(text: string): void {
    this.flash = text
    this.renderStatus()
    window.clearTimeout(this.flashTimer)
    this.flashTimer = window.setTimeout(() => {
      this.flash = ''
      this.renderStatus()
    }, FLASH_MS)
  }

  private addActiveToPrompt(): void {
    const doc = this.active()
    if (!doc) return
    const cursor = doc.editor?.cursor()
    addToPrompt(doc.path, cursor && cursor.selected > 0 ? { start: cursor.startLine, end: cursor.endLine } : undefined)
  }

  private openActiveInCode(): void {
    const doc = this.active()
    if (doc && this.set) openInVsCode(this.set.folder, doc.path, doc.editor ? doc.editor.cursor().line : undefined)
  }

  private async copyPath(): Promise<void> {
    const doc = this.active()
    if (!doc) return
    await api.writeClipboard(doc.path).catch(() => undefined)
    this.setFlash('Path copied')
  }

  private onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault()
      event.stopPropagation()
      void this.save()
      return
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'w') {
      const doc = this.active()
      if (!doc) return
      event.preventDefault()
      event.stopPropagation()
      void this.closeFile(doc.path)
      return
    }
    if (plain && event.key.toLowerCase() === 'e' && !target.closest('input, textarea, select')) {
      const doc = this.active()
      if (!doc || doc.editing || !doc.canEdit) return
      event.preventDefault()
      event.stopPropagation()
      void this.toggleEdit()
    }
  }

  // Rendering

  // Typing reports a change per keystroke; the view only redraws when something it shows differs.
  private docChanged(doc: FileDoc): void {
    const signature = `${doc.path}|${doc.status}|${doc.dirty}|${doc.editing}|${doc.changes}|${doc.conflict}|${doc.deleted}|${doc.stat?.added}|${doc.stat?.removed}|${doc.newFile}`
    if (this.lastSignature.get(doc) === signature) return
    this.lastSignature.set(doc, signature)
    if (doc !== this.active()) this.renderTabs()
    else this.renderAll()
  }

  private cursorMoved(doc: FileDoc, info: CursorInfo): void {
    if (doc !== this.active()) return
    this.cursorText = `Ln ${info.line}, Col ${info.col}`
    this.renderStatus()
  }

  private renderAll(): void {
    this.renderTabs()
    this.renderBar()
    this.renderStage()
    this.renderStatus()
    this.renderSessions()
    this.renderOutline()
  }

  private renderTabs(): void {
    const set = this.set
    this.tabs.hidden = !set || set.tabs.length === 0
    if (!set) return
    this.tabs.replaceChildren(...set.tabs.map((tab) => {
      const doc = set.docs.get(tab.path)
      const classes = ['files-tab']
      if (tab.path === set.active) classes.push('active')
      if (!tab.pinned) classes.push('preview')
      if (doc?.dirty) classes.push('dirty')
      const name = baseName(tab.path)
      return h('div', {
        class: classes.join(' '), role: 'tab', 'data-path': tab.path, 'aria-selected': String(tab.path === set.active), title: tab.path,
        onClick: () => this.activate(tab.path), onDblclick: () => this.pin(tab.path),
        onAuxclick: (event: Event) => {
          if ((event as MouseEvent).button === 1) void this.closeFile(tab.path)
        }
      },
      h('span', { class: 'files-tab-name' }, name),
      doc?.dirty ? h('span', { class: 'files-dot', title: 'Unsaved changes', 'aria-label': 'Unsaved changes' }) : null,
      h('button', { class: 'files-tab-close', type: 'button', 'aria-label': `Close ${name}`, title: `Close ${name}`, onClick: (event: Event) => {
        event.stopPropagation()
        void this.closeFile(tab.path)
      } }, icon(ICONS.closeSmall)))
    }))
  }

  private renderBar(): void {
    const doc = this.active()
    this.bar.hidden = !doc
    if (!doc) return
    const parts = doc.path.split('/')
    this.crumb.replaceChildren(...parts.flatMap((part, index) => [
      ...(index > 0 ? [h('span', { class: 'files-crumb-sep', 'aria-hidden': 'true' }, '/')] : []),
      h('span', { class: index === parts.length - 1 ? 'files-crumb-leaf' : 'files-crumb-part' }, part)
    ]))
    const ready = doc.status === 'ready'
    this.fileButton.setAttribute('aria-pressed', String(!doc.changes))
    this.changesButton.setAttribute('aria-pressed', String(doc.changes))
    this.fileButton.disabled = doc.deleted || !ready
    this.changesButton.disabled = doc.deleted || !ready
    this.editButton.hidden = !ready || doc.deleted
    this.editButton.textContent = doc.editing ? 'Done' : 'Edit'
    this.editButton.setAttribute('aria-pressed', String(doc.editing))
    this.promptButton.disabled = false
    this.codeButton.disabled = false
    this.conflict.hidden = !doc.conflict
  }

  private renderStage(): void {
    const set = this.set
    const doc = this.active()
    if (set) for (const known of set.docs.values()) known.show(known === doc && known.status === 'ready')
    if (!set) {
      this.showPlaceholder('Add a project to browse its files.')
      return
    }
    if (!doc) {
      this.showPlaceholder('Pick a file from the tree, or press Ctrl+P to find one.')
      return
    }
    if (doc.status === 'ready') {
      this.empty.hidden = true
      return
    }
    if (doc.status === 'idle' || doc.status === 'loading') {
      this.showPlaceholder('Opening…')
      return
    }
    this.showPlaceholder(doc.message, doc.status !== 'missing')
  }

  private showPlaceholder(text: string, withCode = false): void {
    this.empty.hidden = false
    this.empty.replaceChildren(h('p', {}, text), ...(withCode ? [h('button', { class: 'btn small', type: 'button', onClick: () => this.openActiveInCode() }, 'Open in VS Code')] : []))
  }

  private renderStatus(): void {
    const doc = this.active()
    this.status.hidden = !doc
    if (!doc) return
    const left = [this.cursorText && doc.status === 'ready' ? this.cursorText : null, languageLabel(doc.path)].filter(Boolean).join('  ·  ')
    let mode = 'Read only · press E to edit'
    if (doc.deleted) mode = 'Deleted since main'
    else if (doc.changes) mode = 'Showing changes since main'
    else if (doc.editing) mode = doc.dirty ? 'Editing · unsaved · Ctrl+S to save' : 'Editing · Ctrl+S to save'
    else if (doc.status !== 'ready') mode = ''
    const stat = doc.stat
    const statEl = stat
      ? h('span', { class: 'files-stat' }, h('span', { class: 'plus' }, `+${stat.added}`), ' ', h('span', { class: 'minus' }, `${minus}${stat.removed}`), doc.newFile ? ' new file' : ' since main')
      : null
    this.status.replaceChildren(h('span', {}, left), h('span', { class: 'files-status-mode' }, this.flash || mode), h('span', { class: 'spacer' }), ...(statEl ? [statEl] : []))
  }

  private renderSessions(): void {
    const doc = this.active()
    const sessions = doc ? this.touches.get(doc.path) ?? [] : []
    if (!doc || sessions.length === 0) {
      this.sessionsList.replaceChildren(h('p', { class: 'files-side-empty' }, doc ? 'No open session has edited this file.' : 'Open a file to see which sessions touched it.'))
      return
    }
    this.sessionsList.replaceChildren(...sessions.map((session) => h('button', { class: 'files-side-row', type: 'button', onClick: () => focusPane(session.paneId) },
      h('span', { class: 'files-side-name' }, session.title),
      h('span', { class: 'files-side-meta' }, `${session.edits} edit${session.edits === 1 ? '' : 's'}`))))
  }

  private renderOutline(): void {
    const doc = this.active()
    const items: OutlineItem[] = doc?.status === 'ready' ? doc.outline() : []
    if (items.length === 0) {
      this.outlineList.replaceChildren(h('p', { class: 'files-side-empty' }, doc ? 'Nothing to outline in this file.' : ''))
      return
    }
    this.outlineList.replaceChildren(...items.map((item) => h('button', {
      class: `files-side-row outline k-${item.kind}`, type: 'button', style: `padding-left:${10 + item.depth * 12}px`, title: `Line ${item.line}`,
      onClick: () => doc?.editor?.reveal(item.from)
    }, h('span', { class: 'files-side-name' }, item.name), h('span', { class: 'files-side-meta' }, String(item.line)))))
  }
}
