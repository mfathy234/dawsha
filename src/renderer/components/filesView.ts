import { pathForms, tabMenu, treeMenu, type FileActionId, type FileMenuEntry } from '../../shared/fileMenus'
import { statusLetter } from '../../shared/gitStatus'
import { normalizeFolder } from '../../shared/folderKey'
import { checkoutLabel, checkoutTabsKey, type FilesCheckout } from '../../shared/filesWorkspace'
import { languageLabel } from '../files/languageInfo'
import { api } from '../api'
import { focusPane, saveSettings } from '../actions'
import { h, icon, leave, placeNearAnchor } from '../dom'
import { ICONS } from '../icons'
import { currentBundle, onThemeChange } from '../themeManager'
import { projectById, store, type AppState } from '../state'
import { FileDoc, type DocHooks } from '../files/fileDoc'
import { noteOpened } from '../files/fileIndex'
import { addToPrompt, filesTarget, onFilesRequest, openInVsCode, setCurrentTarget, setDirtyProvider, takeFilesRequest, type FilesTarget } from '../files/filesActions'
import { closeTab, openTab, pinTab, type TabRef } from '../files/filesState'
import { fileIcon } from '../files/fileIcon'
import { FilesTree, type TreeTarget } from '../files/filesTree'
import { loadTouches, type TouchMap } from '../files/sessionTouch'
import type { EditorTheme } from '../files/editor'
import type { OutlineItem } from '../files/outline'
import { openContextMenu, type ContextEntry } from './contextMenu'
import { confirmDialog } from './dialogs'
import { selectMenu, syncSelectMenu } from './selectMenu'
import { toast } from './toast'
import { RunCommandsPanel } from './runCommandsPanel'
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
  /** The project's place inside its git repository ("" at the root). File paths are repo-relative. */
  prefix: string
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const themeKind = (): EditorTheme => (currentBundle().theme.kind === 'light' ? 'light' : 'dark')
const minus = '−'

export class FilesViewComponent {
  readonly el = h('main', { class: 'files-view', id: 'files-view', 'aria-label': 'Files' })
  private readonly runPanel = new RunCommandsPanel()
  private readonly runButton = h('button', {
    class: 'btn small', type: 'button', id: 'files-run-toggle', 'aria-controls': 'files-run-panel',
    onClick: () => this.runPanel.el.hidden ? this.runPanel.show() : this.runPanel.hide()
  }, 'Run commands')
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
  private readonly lastSignature = new WeakMap<FileDoc, string>()
  private projectSignature = ''
  private watchFailed = false
  private checkoutToken = 0
  private activationToken = 0
  private deletionPending = false
  private checkouts: FilesCheckout[] = []
  private readonly checkoutSelect = h('select', { id: 'files-checkout', 'aria-label': 'Checkout', onChange: (event: Event) => this.switchCheckout((event.target as HTMLSelectElement).value) })
  private readonly checkoutRefresh = h('button', { class: 'btn small', type: 'button', id: 'files-checkout-refresh', title: 'Refresh checkouts and branch', onClick: () => void this.refreshCheckouts() }, 'Refresh')

  private readonly projectSelect = h('select', { id: 'files-project', 'aria-label': 'Project', onChange: (event: Event) => this.switchProject((event.target as HTMLSelectElement).value) })
  private readonly worktreeNote = h('div', { class: 'files-worktree', hidden: true })
  private readonly liveNote = h('div', { class: 'files-worktree', id: 'files-live-note', role: 'status', hidden: true }, 'Live updates are off for this folder')
  private readonly tree = new FilesTree({
    open: (path, pin, focus) => void this.openFile(path, { pin, focus }),
    action: (id, target) => void this.runFileAction(id, target.path, target.kind),
    menu: (target, x, y, returnFocus) => this.openMenu(treeMenu(target.kind, target.open), target, x, y, returnFocus)
  }, h('div', { class: 'files-switcher' }, selectMenu(this.projectSelect), selectMenu(this.checkoutSelect), this.checkoutRefresh, this.runButton, this.worktreeNote, this.liveNote))
  private readonly tabs = h('div', { class: 'files-tabs', role: 'tablist', 'aria-label': 'Open files' })
  private readonly crumb = h('div', { class: 'files-crumb', 'aria-label': 'File path' })
  private readonly fileButton = h('button', { class: 'files-seg', type: 'button', id: 'files-file', 'aria-pressed': 'true', onClick: () => void this.showFileMode() }, 'File')
  private readonly changesButton = h('button', { class: 'files-seg', type: 'button', id: 'files-changes', 'aria-pressed': 'false', title: 'Show what changed since main (click again for the file)', onClick: () => void this.toggleChanges() }, 'Changes')
  private readonly editButton = h('button', { class: 'btn small', type: 'button', id: 'files-edit', onClick: () => this.toggleEdit() }, 'Edit')
  private readonly promptButton = h('button', { class: 'btn small', type: 'button', id: 'files-add-prompt', title: 'Type @path (and the selected lines) into the focused session', onClick: () => this.addActiveToPrompt() }, 'Add to prompt')
  private readonly codeButton = h('button', { class: 'btn small', type: 'button', id: 'files-open-code', 'aria-label': 'Open in VS Code', title: 'Open in VS Code', onClick: () => this.openActiveInCode() }, icon(ICONS.code), h('span', { class: 'files-btn-label' }, 'Open in VS Code'))
  private readonly copyButton = h('button', { class: 'icon-btn', type: 'button', id: 'files-copy-path', 'aria-label': 'Copy path', title: 'Copy path', onClick: () => void this.copyPath() }, icon(ICONS.copy))
  private readonly moreButton = h('button', { class: 'icon-btn files-more', type: 'button', id: 'files-more', 'aria-label': 'More actions', title: 'More actions', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: () => this.toggleMore() }, icon(ICONS.more))
  private moreMenu: HTMLElement | null = null
  private readonly bar = h('div', { class: 'files-bar' })
  private readonly conflictText = h('span', { class: 'files-conflict-text' }, 'This file changed on disk.')
  private readonly reloadButton = h('button', { class: 'btn small', type: 'button', id: 'files-reload-theirs', onClick: () => void this.active()?.reload() }, 'Reload theirs')
  private readonly keepButton = h('button', { class: 'btn small', type: 'button', id: 'files-keep-mine', onClick: () => void this.active()?.overwrite() }, 'Keep mine (overwrite)')
  private readonly conflict = h('div', { class: 'files-conflict', id: 'files-conflict', role: 'alert', hidden: true }, this.conflictText, this.reloadButton, this.keepButton)
  private readonly segment = h('div', { class: 'files-segment', role: 'group', 'aria-label': 'View' }, this.fileButton, this.changesButton)
  private readonly stage = h('div', { class: 'files-stage' })
  private readonly empty = h('div', { class: 'files-placeholder', id: 'files-empty' })
  private readonly status = h('div', { class: 'files-status', id: 'files-status' })
  private readonly side = h('aside', { class: 'files-side', 'aria-label': 'About this file' })
  private readonly sessionsList = h('div', { class: 'files-side-list', id: 'files-sessions' })
  private readonly outlineList = h('div', { class: 'files-side-list', id: 'files-outline' })

  constructor() {
    this.runPanel.el.id = 'files-run-panel'
    this.bar.append(this.crumb, h('span', { class: 'spacer' }), this.segment, this.editButton, this.promptButton, this.codeButton, this.copyButton, this.moreButton)
    this.stage.append(this.empty)
    this.side.append(
      h('section', { class: 'files-side-sec' }, h('h2', {}, 'Sessions that touched it'), this.sessionsList),
      h('section', { class: 'files-side-sec grow' }, h('h2', {}, 'Outline'), this.outlineList))
    this.el.append(this.tree.el, h('div', { class: 'files-main' }, this.tabs, this.bar, this.conflict, this.stage, this.status, this.runPanel.el), this.side)
    this.el.addEventListener('keydown', (event) => this.onKey(event))
    this.tabs.addEventListener('keydown', (event) => this.onTabKey(event))
    api.onFilesChanged((key, paths) => this.onDiskChange(key, paths))
    api.onFilesWatchFailed((key) => {
      if (!this.target || normalizeFolder(this.target.folder) !== key) return
      this.watchFailed = true
      this.renderLiveNote()
    })
    onThemeChange(() => {
      for (const set of this.sets.values()) for (const doc of set.docs.values()) doc.setTheme(themeKind())
    })
    onFilesRequest(() => this.takeRequest())
    setDirtyProvider(() => [...this.sets.values()].flatMap((set) => [...set.docs.values()].filter((doc) => doc.dirty).map((doc) => doc.path)))
  }

  update(state: AppState): void {
    const visible = state.view === 'files'
    if (visible && !this.visible) this.show(state)
    else if (!visible && this.visible) this.hide()
    if (visible) this.syncProjects(state)
  }

  private readonly hooks: DocHooks = {
    theme: themeKind,
    changed: (doc) => this.docChanged(doc),
    edited: (doc) => this.pin(doc.path),
    cursor: (doc) => this.cursorMoved(doc),
    outlineChanged: (doc) => {
      if (doc === this.active()) this.renderOutline()
    }
  }

  // Showing and hiding

  private async show(state: AppState): Promise<void> {
    this.visible = true
    if (this.deletionPending) return
    const request = takeFilesRequest()
    const target = request ?? filesTarget(state)
    if (!target) {
      this.target = null
      this.set = null
      this.renderAll()
      return
    }
    if (!await this.activateTarget(target)) return
    if (request) void this.openFile(request.path, { pin: request.pin, focus: true, line: request.line })
    void this.refreshTouches()
    this.touchTimer = window.setInterval(() => void this.refreshTouches(), TOUCH_REFRESH_MS)
  }

  private hide(): void {
    this.visible = false
    this.tree.setLoading(false)
    this.runPanel.setTarget(null)
    this.runPanel.hide()
    window.clearInterval(this.touchTimer)
    window.clearTimeout(this.watchTimer)
    ++this.checkoutToken
    ++this.activationToken
    ++this.treeToken
    if (this.target) void api.unwatchFiles(this.target.folder)
    this.target = null
    setCurrentTarget(null)
  }

  private async takeRequest(): Promise<void> {
    if (!this.visible || this.deletionPending) return
    const request = takeFilesRequest()
    if (!request) return
    if (!this.target || normalizeFolder(this.target.folder) !== normalizeFolder(request.folder) || this.target.projectId !== request.projectId) {
      if (!await this.activateTarget(request)) return
    }
    void this.openFile(request.path, { pin: request.pin, focus: true, line: request.line })
  }

  private async activateTarget(requested: FilesTarget): Promise<boolean> {
    if (this.deletionPending) return false
    const token = ++this.activationToken
    this.tree.setLoading(true)
    const metadata = await api.filesWorkspaces(requested.projectId, requested.folder).catch(() => ({ ok: false as const, error: 'Could not open this checkout.' }))
    if (token !== this.activationToken || !this.visible || this.deletionPending) return false
    if (!metadata.ok) {
      this.tree.setLoading(false)
      toast(metadata.error)
      void this.refreshCheckouts()
      return false
    }
    const target = { ...requested, folder: metadata.folder }
    if (this.target && normalizeFolder(this.target.folder) !== normalizeFolder(target.folder)) void api.unwatchFiles(this.target.folder)
    const same = this.target !== null && normalizeFolder(this.target.folder) === normalizeFolder(target.folder)
    this.target = target
    this.runPanel.setTarget(target)
    setCurrentTarget(target)
    const key = checkoutTabsKey(target.projectId, target.folder)
    let set = this.sets.get(key)
    if (!set) {
      const saved = store.state.settings.filesTabs[key] ?? []
      set = { projectId: target.projectId, folder: target.folder, docs: new Map(), tabs: saved.map((path) => ({ path, pinned: true })), active: saved[0] ?? null, openFolders: new Set(), prefix: '' }
      this.sets.set(key, set)
    }
    this.set = set
    void this.refreshCheckouts()
    this.tree.adoptFolders(set.openFolders)
    if (!same) void api.watchFiles(target.folder)
    this.touches = new Map()
    this.watchFailed = false
    this.renderLiveNote()
    // Files may have changed while the view was away, so open tabs look at the disk again once the tree is in.
    const treeReady = this.loadTree()
    this.renderAll()
    const active = this.active()
    if (active) void this.loadActive(active)
    await treeReady
    if (token !== this.activationToken || !this.visible) return false
    this.tree.setLoading(false)
    void this.checkOpenDocs()
    return true
  }

  private switchProject(projectId: string): void {
    const project = projectById(store.state, projectId)
    if (!project || !this.visible) return
    void this.activateTarget({ projectId, folder: project.folder }).then((active) => {
      if (active) void this.refreshTouches()
    })
  }

  private switchCheckout(folder: string): void {
    const checkout = this.checkouts.find(entry => normalizeFolder(entry.folder) === normalizeFolder(folder) && !entry.unavailable)
    if (!checkout || !this.target || !this.visible) return
    void this.activateTarget({ projectId: this.target.projectId, folder: checkout.folder }).then((active) => {
      if (active) void this.refreshTouches()
    })
  }

  private async refreshCheckouts(): Promise<void> {
    const target = this.target
    if (!target) return
    const token = ++this.checkoutToken
    const result = await api.filesWorkspaces(target.projectId).catch(() => ({ ok: false as const, error: 'Could not refresh checkouts.' }))
    if (token !== this.checkoutToken || this.target !== target) return
    if (!result.ok) { this.worktreeNote.hidden = false; this.worktreeNote.textContent = result.error; return }
    this.checkouts = result.checkouts
    if (!this.checkouts.some(entry => normalizeFolder(entry.folder) === normalizeFolder(target.folder))) {
      this.checkouts.push({ folder: target.folder, branch: '', head: '', detached: false, unavailable: true, main: false })
    }
    this.checkoutSelect.replaceChildren(...this.checkouts.map(entry => h('option', { value: entry.folder, disabled: entry.unavailable, title: entry.folder }, checkoutLabel(entry))))
    this.checkoutSelect.value = this.checkouts.find(entry => normalizeFolder(entry.folder) === normalizeFolder(target.folder))?.folder ?? target.folder
    this.checkoutSelect.title = target.folder
    syncSelectMenu(this.checkoutSelect)
    this.renderCheckoutContext()
    this.renderStatus()
  }

  private renderCheckoutContext(): void {
    const checkout = this.checkouts.find(entry => this.target && normalizeFolder(entry.folder) === normalizeFolder(this.target.folder))
    this.worktreeNote.hidden = !checkout
    this.worktreeNote.textContent = checkout ? checkoutLabel(checkout) : ''
    this.worktreeNote.title = checkout?.folder ?? ''
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
    this.renderCheckoutContext()
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
      if (listing.ok) set.prefix = listing.prefix
      this.tree.setActive(set.active)
    }
  }

  private checkOpenDocs(paths: readonly string[] = []): void {
    const set = this.set
    if (!set) return
    for (const doc of set.docs.values()) if (paths.length === 0 || paths.includes(doc.path)) void doc.checkDisk()
  }

  private async refreshTouches(): Promise<void> {
    void this.refreshCheckouts()
    const target = this.target
    if (!target) return
    const touches = await loadTouches(target.projectId, target.folder, this.set?.prefix ?? '').catch(() => new Map() as TouchMap)
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
      this.checkOpenDocs(paths)
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
    if (this.deletionPending) return
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
    if (this.set !== set || set.active !== path) return
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

  private activate(path: string, focusEditor = true): void {
    const set = this.set
    if (!set || set.active === path) return
    set.active = path
    const doc = this.docFor(path)
    this.tree.setActive(path)
    this.renderAll()
    if (doc) void this.loadActive(doc).then(() => (focusEditor ? doc.editor?.focus() : undefined))
  }

  private persistTabs(set: DocSet | null = this.set): void {
    if (!set) return
    const filesTabs = { ...store.state.settings.filesTabs }
    const paths = set.tabs.map((tab) => tab.path)
    const key = checkoutTabsKey(set.projectId, set.folder)
    if (paths.length === 0) delete filesTabs[key]
    else filesTabs[key] = paths
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
    addToPrompt(doc.path, cursor && cursor.selected > 0 ? { start: cursor.startLine, end: cursor.endLine } : undefined, this.set?.prefix ?? '')
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

  // Right-click menus. Both the tree and the tabs run the same actions on a repo-relative path.

  private entriesFor(spec: readonly FileMenuEntry[], path: string, kind: 'file' | 'folder'): ContextEntry[] {
    return spec.map((entry) => (entry === 'separator' ? entry : { label: entry.label, keys: entry.keys, disabled: entry.disabled, run: () => void this.runFileAction(entry.id, path, kind) }))
  }

  private openMenu(spec: readonly FileMenuEntry[], target: TreeTarget, x: number, y: number, returnFocus: HTMLElement): void {
    openContextMenu({ x, y, label: target.kind === 'folder' ? 'Folder actions' : 'File actions', entries: this.entriesFor(spec, target.path, target.kind), returnFocus })
  }

  private openTabMenu(path: string, x: number, y: number, returnFocus: HTMLElement): void {
    const tabs = this.set?.tabs ?? []
    openContextMenu({ x, y, label: 'Tab actions', entries: this.entriesFor(tabMenu(tabs.findIndex((tab) => tab.path === path), tabs.length), path, 'file'), returnFocus })
  }

  private async copyText(text: string, done: string): Promise<void> {
    try {
      await api.writeClipboard(text)
      this.setFlash(done)
    } catch {
      toast('Could not copy to the clipboard.')
    }
  }

  private async closeMany(paths: readonly string[]): Promise<void> {
    for (const path of paths) await this.closeFile(path)
  }

  async runFileAction(id: FileActionId, path: string, kind: 'file' | 'folder' = 'file'): Promise<void> {
    if (this.deletionPending) return
    const set = this.set
    if (!set) return
    const forms = pathForms(set.folder, set.prefix, path)
    const tabs = set.tabs.map((tab) => tab.path)
    switch (id) {
      case 'open': return this.openFile(path, { pin: true, focus: true })
      case 'open-new-tab': return this.openFile(path, { pin: true })
      case 'toggle': return this.tree.toggleFolder(path)
      case 'delete': return this.deletePath(path, kind)
      case 'add-prompt':
        if (kind === 'file') addToPrompt(path, undefined, set.prefix)
        return
      case 'copy-path': return this.copyText(forms.absolute, 'Path copied')
      case 'copy-relative': return this.copyText(forms.relative, 'Relative path copied')
      case 'open-code': {
        const doc = set.docs.get(path)
        if (kind === 'file') openInVsCode(set.folder, path, doc?.editor ? doc.editor.cursor().line : undefined)
        return
      }
      case 'reveal':
        return api.revealProjectPath(set.folder, path).then(
          (result) => { if (!result.ok) toast('Could not show that in the file manager.') },
          () => toast('Could not show that in the file manager.')
        )
      case 'show-changes': {
        await this.openFile(path, { pin: true })
        const doc = this.active()
        if (doc && !doc.changes) await doc.toggleChanges()
        return
      }
      case 'close': return this.closeFile(path)
      case 'close-others': return this.closeMany(tabs.filter((known) => known !== path))
      case 'close-right': {
        const at = tabs.indexOf(path)
        return at === -1 ? undefined : this.closeMany(tabs.slice(at + 1))
      }
      default: return
    }
  }

  private async deletePath(path: string, kind: 'file' | 'folder'): Promise<void> {
    const set = this.set
    if (!set || this.deletionPending) return
    // Keep the consent snapshot stable until Trash resolves, including across view changes.
    this.deletionPending = true
    ++this.activationToken
    this.el.inert = true
    this.el.setAttribute('aria-busy', 'true')
    try {
      const affected = [...set.docs.values()].filter(doc => doc.path === path || (kind === 'folder' && doc.path.startsWith(`${path}/`)))
      const dirty = affected.filter(doc => doc.dirty)
      const destination = navigator.platform.startsWith('Win') ? 'Recycle Bin' : 'Trash'
      const confirmed = await confirmDialog({
        title: `Move ${kind} to ${destination}?`,
        body: `${pathForms(set.folder, set.prefix, path).relative}${kind === 'folder' ? '\nThis includes the folder and everything inside it.' : ''}\n${dirty.length ? `Unsaved changes will be discarded in:\n${dirty.map(doc => doc.path).join('\n')}\n` : ''}Move to ${destination}?`,
        confirmLabel: dirty.length ? `Discard changes and move to ${destination}` : `Move to ${destination}`
      })
      if (!confirmed) return
      toast(`Moving ${pathForms(set.folder, set.prefix, path).relative} to ${destination}…`, 'info')
      const result = await api.trashProjectPath(set.folder, pathForms(set.folder, set.prefix, path).relative).catch((error: Error) => ({ ok: false as const, error: error.message }))
      if (!result.ok) { toast(result.error); return }
      for (const doc of affected) { doc.destroy(); set.docs.delete(doc.path) }
      set.tabs = set.tabs.filter(tab => tab.path !== path && !(kind === 'folder' && tab.path.startsWith(`${path}/`)))
      if (!set.tabs.some(tab => tab.path === set.active)) set.active = set.tabs[0]?.path ?? null
      this.persistTabs(set)
      if (this.set === set) {
        this.renderAll()
        await this.loadTree()
        const active = set.active ? this.docFor(set.active) : null
        if (active) await this.loadActive(active)
      }
    } finally {
      this.deletionPending = false
      this.el.inert = false
      this.el.removeAttribute('aria-busy')
      if (this.visible && !this.target) {
        void this.activateTarget({ projectId: set.projectId, folder: set.folder }).then(active => {
          if (!active) return
          void this.refreshTouches()
          window.clearInterval(this.touchTimer)
          this.touchTimer = window.setInterval(() => void this.refreshTouches(), TOUCH_REFRESH_MS)
          void this.takeRequest()
        })
      }
    }
  }

  // Roving tabindex: the active tab is the one Tab stops on; Left/Right/Home/End move between tabs.
  private onTabKey(event: KeyboardEvent): void {
    const set = this.set
    const current = (event.target as HTMLElement).closest<HTMLElement>('.files-tab')
    if (!set || !current || (event.target as HTMLElement).closest('.files-tab-close')) return
    const paths = set.tabs.map((tab) => tab.path)
    const at = paths.indexOf(current.dataset.path ?? '')
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault()
      event.stopPropagation()
      const box = current.getBoundingClientRect()
      this.openTabMenu(paths[at], box.left + 12, box.bottom, current)
      return
    }
    let next = at
    if (event.key === 'ArrowRight') next = (at + 1) % paths.length
    else if (event.key === 'ArrowLeft') next = (at - 1 + paths.length) % paths.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = paths.length - 1
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      this.activate(paths[at])
      return
    } else return
    event.preventDefault()
    event.stopPropagation()
    this.activate(paths[next], false)
    this.tabs.querySelector<HTMLElement>(`.files-tab[data-path="${CSS.escape(paths[next])}"]`)?.focus()
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
    const signature = `${doc.path}|${doc.status}|${doc.dirty}|${doc.editing}|${doc.changes}|${doc.conflict}|${doc.gone}|${doc.noRepo}|${doc.deleted}|${doc.stat?.added}|${doc.stat?.removed}|${doc.newFile}`
    if (this.lastSignature.get(doc) === signature) return
    this.lastSignature.set(doc, signature)
    if (doc !== this.active()) this.renderTabs()
    else this.renderAll()
  }

  private cursorMoved(doc: FileDoc): void {
    if (doc !== this.active()) return
    this.renderStatus()
  }

  private renderLiveNote(): void {
    this.liveNote.hidden = !this.watchFailed
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
        tabindex: tab.path === set.active ? '0' : '-1',
        onClick: () => this.activate(tab.path), onDblclick: () => this.pin(tab.path),
        onContextmenu: (event: Event) => {
          event.preventDefault()
          const at = event as MouseEvent
          this.openTabMenu(tab.path, at.clientX, at.clientY, event.currentTarget as HTMLElement)
        },
        onAuxclick: (event: Event) => {
          if ((event as MouseEvent).button === 1) void this.closeFile(tab.path)
        }
      },
      fileIcon(tab.path),
      h('span', { class: 'files-tab-name' }, name),
      doc?.dirty ? h('span', { class: 'files-dot', title: 'Unsaved changes', 'aria-label': 'Unsaved changes' }, '•') : null,
      h('button', { class: 'files-tab-close', type: 'button', 'aria-label': `Close ${name}`, title: `Close ${name}`, onClick: (event: Event) => {
        event.stopPropagation()
        void this.closeFile(tab.path)
      } }, icon(ICONS.closeSmall)))
    }))
  }

  private readonly moreOutside = (event: Event): void => {
    const target = event.target as Node
    if (this.moreMenu && !this.moreMenu.contains(target) && !this.moreButton.contains(target)) this.closeMore()
  }

  private closeMore(): void {
    document.removeEventListener('pointerdown', this.moreOutside, true)
    leave(this.moreMenu)
    this.moreMenu = null
    this.moreButton.setAttribute('aria-expanded', 'false')
  }

  /** On a narrow editor the bar keeps File/Changes, Edit and Copy path; the rest live in this menu. */
  private toggleMore(): void {
    if (this.moreMenu) {
      this.closeMore()
      return
    }
    const entry = (label: string, run: () => void): HTMLElement => h('button', { class: 'menu-item', type: 'button', role: 'menuitem', onClick: () => { this.closeMore(); run() } }, label)
    const items = [entry('Add to prompt', () => this.addActiveToPrompt()), entry('Open in VS Code', () => this.openActiveInCode())]
    const menu = h('div', { class: 'popover menu floating', role: 'menu', 'aria-label': 'More actions' }, ...items)
    menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      this.closeMore()
      this.moreButton.focus()
    })
    document.body.appendChild(menu)
    placeNearAnchor(menu, this.moreButton)
    this.moreMenu = menu
    this.moreButton.setAttribute('aria-expanded', 'true')
    items[0].focus()
    setTimeout(() => document.addEventListener('pointerdown', this.moreOutside, true), 0)
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
    this.conflictText.textContent = doc.gone ? 'This file was deleted on disk.' : 'This file changed on disk.'
    this.reloadButton.hidden = doc.gone
    this.keepButton.textContent = doc.gone ? 'Keep mine (recreate)' : 'Keep mine (overwrite)'
    this.segment.hidden = doc.noRepo
  }

  private renderStage(): void {
    const set = this.set
    const doc = this.active()
    for (const saved of this.sets.values()) for (const known of saved.docs.values()) known.show(saved === set && known === doc && known.status === 'ready')
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
    const checkout = this.checkouts.find(entry => this.target && normalizeFolder(entry.folder) === normalizeFolder(this.target.folder))
    this.status.hidden = !doc && !checkout
    if (!doc) {
      this.status.replaceChildren(...(checkout ? [h('span', { title: checkout.folder }, checkoutLabel(checkout))] : []))
      return
    }
    const cursor = doc.editor && doc.status === 'ready' ? doc.editor.cursor() : null
    const left = [cursor ? `Ln ${cursor.line}, Col ${cursor.col}` : null, languageLabel(doc.path)].filter(Boolean).join('  ·  ')
    let mode = 'Read only · press E to edit'
    if (doc.deleted) mode = 'Deleted since main'
    else if (doc.changes) mode = 'Showing changes since main'
    else if (doc.editing) mode = doc.dirty ? 'Editing · unsaved · Ctrl+S to save' : 'Editing · Ctrl+S to save'
    else if (doc.status !== 'ready') mode = ''
    const stat = doc.stat
    const statEl = stat
      ? h('span', { class: 'files-stat' }, h('span', { class: 'plus' }, `+${stat.added}`), ' ', h('span', { class: 'minus' }, `${minus}${stat.removed}`), doc.newFile ? ' new file' : ' since main')
      : null
    this.status.replaceChildren(h('span', {}, left), h('span', { class: 'files-status-mode' }, this.flash || mode), h('span', { class: 'spacer' }), ...(checkout ? [h('span', { title: checkout.folder }, checkoutLabel(checkout))] : []), ...(statEl ? [statEl] : []))
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
