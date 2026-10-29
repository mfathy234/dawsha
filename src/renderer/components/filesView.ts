import { pathForms, tabMenu, treeMenu, type FileActionId, type FileMenuEntry } from '../../shared/fileMenus'
import { statusLetter } from '../../shared/gitStatus'
import { normalizeFolder } from '../../shared/folderKey'
import { branchLine, checkoutLabel, checkoutTabsKey, type FilesCheckout } from '../../shared/filesWorkspace'
import { INSPECTOR_MIN_WIDTH, type InspectorTab } from '../../shared/filesLayout'
import { blameLines, type BlameSource } from '../../shared/fileActivity'
import { toProjectPath, toRepoPath } from '../../shared/projectPaths'
import { buildReviewMessage, draftCommitMessage, stepReview } from '../../shared/review'
import { runningSummary, runningText } from '../../shared/runStatus'
import type { FileCommit } from '../../shared/filePreview'
import type { LinkedRepo } from '../../shared/linkedRepos'
import type { GitFileEntry } from '../../shared/gitStatus'
import { languageLabel } from '../files/languageInfo'
import { api } from '../api'
import { focusPane, saveSettings, startSessionIn } from '../actions'
import { derivePanes } from '../derive'
import { h, icon } from '../dom'
import { currentBundle, onThemeChange } from '../themeManager'
import { projectById, store, type AppState } from '../state'
import { paneTerminal } from '../terminalActions'
import { lastOutputAt } from '../ptyActivity'
import { waitForSessionOutput, waitUntil } from '../files/sessionWait'
import { FileDoc, type DocHooks } from '../files/fileDoc'
import { noteOpened } from '../files/fileIndex'
import { filesTarget, insertIntoSession, onFilesRequest, onFilesSearchRequest, openInVsCode, promptReference, setCurrentTarget, setDirtyProvider, takeFilesRequest, addToPrompt, type FilesTarget } from '../files/filesActions'
import { closeTab, openTab, pinTab, type TabRef } from '../files/filesState'
import { fileIcon } from '../files/fileIcon'
import { loadSessionData, orderSessions, type TouchMap } from '../files/sessionTouch'
import type { EditorTheme } from '../files/editor'
import { Explorer } from '../files/explorer'
import { FilesBar } from '../files/filesBar'
import { Inspector } from '../files/inspector'
import { BottomPanel } from '../files/bottomPanel'
import { PreviewPane } from '../files/previewPane'
import { commitDialog } from '../files/commitDialog'
import { locationEntries, sendEntries } from '../files/locationMenu'
import { filesLayout, updateLayout } from '../files/filesPrefs'
import { reviewExtension, type DraftComment } from '../files/reviewEditor'
import type { TreeTarget } from '../files/filesTree'
import type { ReviewFile } from '../files/reviewPanel'
import { openContextMenu, type ContextEntry } from './contextMenu'
import { confirmDialog } from './dialogs'
import { toast } from './toast'
import { toggleQuickOpen } from './quickOpen'
import { RunCommandsPanel } from './runCommandsPanel'
import './filesView.css'

const TOUCH_REFRESH_MS = 8000
const WATCH_DEBOUNCE_MS = 150
const FLASH_MS = 1600
const SESSION_START_WAIT_MS = 15_000
const SESSION_SETTLE_MS = 3000
const SESSION_QUIET_MS = 600

interface ReviewState {
  viewed: Set<string>
  comments: DraftComment[]
  note: string
  current: string | null
}

interface DocSet {
  projectId: string
  folder: string
  docs: Map<string, FileDoc>
  tabs: TabRef[]
  active: string | null
  openFolders: Set<string>
  /** The project's place inside its git repository ("" at the root). File paths are repo-relative. */
  prefix: string
  review: ReviewState
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const themeKind = (): EditorTheme => (currentBundle().theme.kind === 'light' ? 'light' : 'dark')
const folderTail = (folder: string): string => folder.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? folder
const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

export class FilesViewComponent {
  readonly el = h('main', { class: 'files-view', id: 'files-view', 'aria-label': 'Files' })
  private readonly runPanel = new RunCommandsPanel()
  private readonly panel = new BottomPanel(this.runPanel, () => {
    // the panel reports while it is built, before the status bar below exists
    if (this.status !== undefined) this.renderStatus()
  }, {
    open: (path, line) => void this.openFile(toRepoPath(this.set?.prefix ?? '', path), { pin: true, focus: true, line }),
    send: (text, anchor) => this.sendProblems(text, anchor)
  })
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
  private readonly annotationSignature = new WeakMap<FileDoc, string>()
  private watchFailed = false
  private checkoutToken = 0
  private activationToken = 0
  private deletionPending = false
  private checkouts: FilesCheckout[] = []
  private isGit = true
  private statusFiles: GitFileEntry[] = []
  private linked: LinkedRepo[] = []
  private linkedKey = ''
  private commits = new Map<string, FileCommit[]>()
  private commitsKey = ''
  private readonly fits = window.matchMedia(`(min-width: ${INSPECTOR_MIN_WIDTH}px)`)
  private readonly worktreeNote = h('div', { class: 'files-worktree', id: 'files-live-note', role: 'status', hidden: true }, 'Live updates are off for this folder')
  private readonly explorer = new Explorer({
    tree: {
      open: (path, pin, focus) => void this.openFile(path, { pin, focus }),
      action: (id, target) => void this.runFileAction(id, target.path, target.kind),
      menu: (target, x, y, returnFocus) => this.openMenu(treeMenu(target.kind, target.open), target, x, y, returnFocus)
    },
    search: {
      folder: () => this.target?.folder ?? null,
      run: (folder, request) => api.searchFiles(folder, request),
      open: (path, line) => void this.openFile(path, { pin: true, focus: true, line })
    },
    review: {
      open: (path) => void this.reviewOpen(path),
      toggleViewed: (path, viewed) => this.toggleViewed(path, viewed),
      step: (direction) => void this.reviewStep(direction),
      note: (text) => {
        if (this.set) this.set.review.note = text
        this.renderReview(false)
      },
      send: (anchor) => this.sendReview(anchor),
      commit: () => void this.commitChanges(),
      discard: (path) => void this.discardFile(path)
    },
    goToFile: () => toggleQuickOpen(),
    openLocation: (button) => this.openLocationMenu(button),
    rowMenu: (path, x, y, returnFocus) => openContextMenu({ x, y, label: 'File actions', entries: this.entriesFor(treeMenu('file', false), path, 'file'), returnFocus }),
    openRow: (path, pin) => void this.openFile(path, { pin, focus: false })
  })
  private readonly tabs = h('div', { class: 'files-tabs', role: 'tablist', 'aria-label': 'Open files' })
  private readonly bar = new FilesBar({
    showFile: () => void this.showFileMode(),
    showChanges: () => void this.toggleChanges(),
    setPreview: (on) => this.setPreview(on),
    done: () => this.toggleEdit(),
    send: (anchor) => this.openSendMenu(anchor),
    more: (anchor) => this.openMoreMenu(anchor),
    toggleInspector: () => this.toggleInspector()
  })
  private readonly conflictText = h('span', { class: 'files-conflict-text' }, 'This file changed on disk.')
  private readonly reloadButton = h('button', { class: 'btn small', type: 'button', id: 'files-reload-theirs', onClick: () => void this.active()?.reload() }, 'Reload theirs')
  private readonly keepButton = h('button', { class: 'btn small', type: 'button', id: 'files-keep-mine', onClick: () => void this.active()?.overwrite() }, 'Keep mine (overwrite)')
  private readonly conflict = h('div', { class: 'files-conflict', id: 'files-conflict', role: 'alert', hidden: true }, this.conflictText, this.reloadButton, this.keepButton)
  private readonly stage = h('div', { class: 'files-stage' })
  private readonly empty = h('div', { class: 'files-placeholder', id: 'files-empty' })
  private readonly preview = new PreviewPane({
    openBrowser: () => void this.openActiveInBrowser(),
    openLink: (url) => void api.openExternal(url)
  })
  private readonly status = h('div', { class: 'files-status', id: 'files-status' })
  private readonly inspector = new Inspector({
    tab: (tab) => this.setInspectorTab(tab),
    jump: (item) => this.active()?.editor?.reveal(item.from),
    focusSession: (paneId) => focusPane(paneId)
  })

  constructor() {
    this.stage.append(this.empty, this.preview.el)
    this.el.append(this.explorer.el, h('div', { class: 'files-main' }, this.tabs, this.bar.el, this.conflict, this.stage, this.panel.el, this.status), this.inspector.el)
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
    onFilesSearchRequest(() => {
      if (this.visible) this.explorer.setMode('search')
    })
    this.fits.addEventListener('change', () => this.applyInspector())
    setDirtyProvider(() => [...this.sets.values()].flatMap((set) => [...set.docs.values()].filter((doc) => doc.dirty).map((doc) => doc.path)))
    this.inspector.setTab(filesLayout().inspector.tab)
    this.applyInspector()
  }

  update(state: AppState): void {
    const visible = state.view === 'files'
    if (visible && !this.visible) this.show(state)
    else if (!visible && this.visible) this.hide()
    if (visible) this.renderLocation()
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
    if (request?.path) void this.openFile(request.path, { pin: request.pin, focus: true, line: request.line })
    void this.refreshTouches()
    this.touchTimer = window.setInterval(() => void this.refreshTouches(), TOUCH_REFRESH_MS)
  }

  private hide(): void {
    this.visible = false
    this.explorer.tree.setLoading(false)
    this.runPanel.setTarget(null)
    this.panel.refresh()
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
    if (request.path) void this.openFile(request.path, { pin: request.pin, focus: true, line: request.line })
  }

  private async activateTarget(requested: FilesTarget): Promise<boolean> {
    if (this.deletionPending) return false
    const token = ++this.activationToken
    this.explorer.tree.setLoading(true)
    const metadata = await api.filesWorkspaces(requested.projectId, requested.folder).catch(() => ({ ok: false as const, error: 'Could not open this checkout.' }))
    if (token !== this.activationToken || !this.visible || this.deletionPending) return false
    if (!metadata.ok) {
      this.explorer.tree.setLoading(false)
      toast(metadata.error)
      void this.refreshCheckouts()
      return false
    }
    const target = { ...requested, folder: metadata.folder }
    if (this.target && normalizeFolder(this.target.folder) !== normalizeFolder(target.folder)) void api.unwatchFiles(this.target.folder)
    const same = this.target !== null && normalizeFolder(this.target.folder) === normalizeFolder(target.folder)
    this.target = target
    this.isGit = metadata.git
    this.runPanel.setTarget(target)
    this.panel.refresh()
    setCurrentTarget(target)
    const key = checkoutTabsKey(target.projectId, target.folder)
    let set = this.sets.get(key)
    if (!set) {
      const saved = store.state.settings.filesTabs[key] ?? []
      set = {
        projectId: target.projectId, folder: target.folder, docs: new Map(), tabs: saved.map((path) => ({ path, pinned: true })), active: saved[0] ?? null,
        openFolders: new Set(), prefix: '', review: { viewed: new Set(), comments: [], note: '', current: null }
      }
      this.sets.set(key, set)
    }
    this.set = set
    void this.refreshCheckouts()
    this.explorer.tree.adoptFolders(set.openFolders)
    if (!same) {
      void api.watchFiles(target.folder)
      this.explorer.search.reset()
      this.statusFiles = []
    }
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
    this.explorer.tree.setLoading(false)
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
    const checkout = this.checkouts.find((entry) => normalizeFolder(entry.folder) === normalizeFolder(folder) && !entry.unavailable)
    if (!checkout || !this.target || !this.visible) return
    void this.activateTarget({ projectId: this.target.projectId, folder: checkout.folder }).then((active) => {
      if (active) void this.refreshTouches()
    })
  }

  private openLinked(repo: LinkedRepo): void {
    if (repo.projectId === null || !this.visible) return
    void this.activateTarget({ projectId: repo.projectId, folder: repo.folder }).then((active) => {
      if (active) void this.refreshTouches()
    })
  }

  private async refreshCheckouts(): Promise<void> {
    const target = this.target
    if (!target) return
    const token = ++this.checkoutToken
    const result = await api.filesWorkspaces(target.projectId).catch(() => ({ ok: false as const, error: 'Could not refresh checkouts.' }))
    if (token !== this.checkoutToken || this.target !== target) return
    if (!result.ok) return
    this.checkouts = result.checkouts
    this.isGit = result.git
    if (!this.checkouts.some((entry) => normalizeFolder(entry.folder) === normalizeFolder(target.folder))) {
      this.checkouts.push({ folder: target.folder, branch: '', head: '', detached: false, unavailable: true, main: false })
    }
    this.renderLocation()
    this.renderStatus()
  }

  private currentCheckout(): FilesCheckout | undefined {
    const target = this.target
    return target ? this.checkouts.find((entry) => normalizeFolder(entry.folder) === normalizeFolder(target.folder)) : undefined
  }

  private renderLocation(): void {
    const target = this.target
    const project = target ? projectById(store.state, target.projectId) : undefined
    const checkout = this.currentCheckout()
    this.explorer.setLocation(project?.name ?? '', branchLine(checkout, this.isGit), target ? `${project?.name ?? ''}\n${target.folder}` : '')
    this.explorer.setTreeTitle(target ? folderTail(target.folder) : '')
  }

  // Menus

  private openLocationMenu(button: HTMLElement): void {
    void this.showLocationMenu(button)
  }

  private async showLocationMenu(button: HTMLElement): Promise<void> {
    if (!this.target) return
    await this.refreshCheckouts()
    const target = this.target
    if (!target) return
    const project = projectById(store.state, target.projectId)
    const box = button.getBoundingClientRect()
    this.explorer.setLocationOpen(true)
    openContextMenu({
      x: box.left, y: box.bottom + 2, label: 'Project and checkout', returnFocus: () => { this.explorer.setLocationOpen(false); button.focus() },
      entries: locationEntries({
        projects: store.state.settings.projects, projectId: target.projectId, projectName: project?.name ?? 'this project', folder: target.folder, checkouts: this.checkouts, linked: this.linked,
        switchProject: (id) => this.switchProject(id),
        switchCheckout: (folder) => this.switchCheckout(folder),
        openLinked: (repo) => this.openLinked(repo),
        copyPath: () => void this.copyText(target.folder, 'Path copied'),
        reveal: () => void api.quickOpen('explorer', target.folder)
      })
    })
    window.setTimeout(() => this.explorer.setLocationOpen(false), 0)
    this.watchMenuClose(() => this.explorer.setLocationOpen(false))
  }

  private watchMenuClose(done: () => void): void {
    const check = (): void => {
      if (document.querySelector('.ctx-menu:not(.leaving)')) window.setTimeout(check, 120)
      else done()
    }
    window.setTimeout(check, 200)
  }

  private liveSessions(): Array<{ paneId: string; title: string }> {
    const projectId = this.target?.projectId
    if (!projectId) return []
    return derivePanes(store.state)
      .filter((view) => view.pane.projectId === projectId && view.agent !== 'shell' && !view.activeExited && paneTerminal(view.pane.id) !== undefined)
      .map((view) => ({ paneId: view.pane.id, title: view.title }))
  }

  private openSendMenu(anchor: HTMLElement): void {
    const doc = this.active()
    const set = this.set
    if (!doc || !set) return
    const cursor = doc.editor?.cursor()
    const range = cursor && cursor.selected > 0 ? { start: cursor.startLine, end: cursor.endLine } : undefined
    const reference = promptReference(toProjectPath(set.prefix, doc.path), range)
    const box = anchor.getBoundingClientRect()
    this.bar.setMenuOpen('send', true)
    openContextMenu({
      x: box.left, y: box.bottom + 2, label: 'Send to agent', returnFocus: anchor,
      entries: sendEntries({
        sessions: this.liveSessions(),
        sendTo: (paneId) => void insertIntoSession(paneId, reference),
        newSession: () => void this.newSessionWith(reference),
        copyMention: () => void this.copyText(reference.trim(), '@mention copied')
      })
    })
    this.watchMenuClose(() => this.bar.setMenuOpen('send', false))
  }

  private async newSessionWith(reference: string): Promise<void> {
    const target = this.target
    if (!target?.projectId) return
    toast('Starting a session…', 'info')
    const paneId = await startSessionIn(target.projectId, target.folder)
    if (!paneId) return
    const tabId = (): string | undefined => store.state.panes.find((pane) => pane.id === paneId)?.activeTabId
    const options = { timeoutMs: SESSION_START_WAIT_MS, stepMs: 200, sleep: wait }
    await waitUntil(() => paneTerminal(paneId) !== undefined, options)
    await waitForSessionOutput(() => lastOutputAt(tabId() ?? ''), Date.now, options, SESSION_QUIET_MS, SESSION_SETTLE_MS)
    insertIntoSession(paneId, reference)
  }

  private openMoreMenu(anchor: HTMLElement): void {
    const doc = this.active()
    const set = this.set
    if (!doc || !set) return
    const entries: ContextEntry[] = [
      { label: 'Edit', keys: 'E', disabled: !doc.canEdit || doc.editing, run: () => void this.toggleEdit() },
      { label: 'Open in VS Code', run: () => this.openActiveInCode() },
      { label: 'Copy path', run: () => void this.runFileAction('copy-path', doc.path) },
      { label: 'Copy relative path', run: () => void this.runFileAction('copy-relative', doc.path) },
      { label: 'Reveal in File Explorer', run: () => void this.runFileAction('reveal', doc.path) },
      'separator',
      { label: `Delete ${baseName(doc.path)}…`, run: () => void this.runFileAction('delete', doc.path) }
    ]
    const box = anchor.getBoundingClientRect()
    this.bar.setMenuOpen('more', true)
    openContextMenu({ x: box.right - 4, y: box.bottom + 2, label: 'More actions', entries, returnFocus: anchor })
    this.watchMenuClose(() => this.bar.setMenuOpen('more', false))
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
    this.statusFiles = git?.ok ? git.status.files : []
    if (git?.ok) for (const file of git.status.files) status.set(file.path, statusLetter(file))
    this.explorer.tree.setData(listing.ok ? listing.files : [], status, listing.ok ? '' : listing.error)
    const set = this.set
    if (set) {
      if (listing.ok) set.prefix = listing.prefix
      this.explorer.setActive(set.active)
    }
    this.explorer.setChanges(this.statusFiles.map((file) => ({ path: file.path, letter: statusLetter(file) })))
    this.renderReview()
    this.renderStage()
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
    const others = this.checkouts.map((entry) => entry.folder)
    const data = await loadSessionData(target.projectId, target.folder, this.set?.prefix ?? '', others).catch(() => null)
    if (!data || this.target !== target) return
    this.touches = data.touches
    this.renderTouches()
    void this.refreshLinked(target, data.external)
  }

  private async refreshLinked(target: FilesTarget, folders: string[]): Promise<void> {
    const key = `${target.projectId}|${folders.join('|')}`
    if (key === this.linkedKey) return
    let linked: LinkedRepo[] = []
    if (folders.length > 0) {
      try {
        linked = await api.linkedRepos(target.projectId, folders)
      } catch {
        return
      }
    }
    if (this.target !== target) return
    this.linkedKey = key
    this.linked = linked
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
    this.explorer.setActive(path)
    if (options.line && doc && doc.previewing && doc.previewKind !== 'image') doc.setPreview(false)
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
    this.explorer.setActive(set.active)
    const active = this.active() ?? (set.active ? this.docFor(set.active) : null)
    this.renderAll()
    if (active) await this.loadActive(active)
  }

  private activate(path: string, focusEditor = true): void {
    const set = this.set
    if (!set || set.active === path) return
    set.active = path
    const doc = this.docFor(path)
    this.explorer.setActive(path)
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

  private setPreview(on: boolean): void {
    const doc = this.active()
    if (!doc) return
    if (on && doc.changes) void doc.toggleChanges()
    doc.setPreview(on)
    if (!on) doc.editor?.focus()
  }

  private async toggleEdit(): Promise<void> {
    const doc = this.active()
    if (!doc) return
    if (doc.editing) {
      doc.stopEdit()
      return
    }
    if (doc.previewing && doc.previewKind !== null) doc.setPreview(false)
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

  private openActiveInCode(): void {
    const doc = this.active()
    if (doc && this.set) openInVsCode(this.set.folder, doc.path, doc.editor ? doc.editor.cursor().line : undefined)
  }

  private async openActiveInBrowser(): Promise<void> {
    const doc = this.active()
    if (!doc || !this.set) return
    const result = await api.openFileInBrowser(this.set.folder, doc.path).catch(() => null)
    if (!result?.ok) toast('Could not open that in the browser.')
  }

  // Inspector

  private inspectorShown(): boolean {
    return filesLayout().inspector.open && this.fits.matches
  }

  private applyInspector(): void {
    this.el.classList.toggle('no-inspector', !this.inspectorShown())
    this.renderBar()
  }

  private toggleInspector(): void {
    updateLayout((layout) => ({ ...layout, inspector: { ...layout.inspector, open: !layout.inspector.open } }))
    this.applyInspector()
  }

  private setInspectorTab(tab: InspectorTab): void {
    updateLayout((layout) => ({ ...layout, inspector: { ...layout.inspector, tab } }))
    this.inspector.setTab(tab)
    if (tab === 'activity') void this.loadCommits()
  }

  private async loadCommits(): Promise<void> {
    const doc = this.active()
    const set = this.set
    if (!doc || !set) return
    const key = `${set.folder}|${doc.path}`
    this.commitsKey = key
    if (!this.commits.has(key)) {
      const result = await api.fileLog(set.folder, doc.path).catch(() => null)
      if (result?.ok) this.commits.set(key, result.commits)
      else this.commits.set(key, [])
    }
    if (this.commitsKey === key) this.renderActivity()
  }

  // Review

  private reviewFiles(): ReviewFile[] {
    return this.statusFiles.map((file) => ({ path: file.path, letter: statusLetter(file), added: file.added, removed: file.removed }))
  }

  private renderReview(updateCounts = true): void {
    const set = this.set
    if (!set) return
    const files = this.reviewFiles()
    const paths = new Set(files.map((file) => file.path))
    for (const path of [...set.review.viewed]) if (!paths.has(path)) set.review.viewed.delete(path)
    const counts = new Map<string, number>()
    for (const comment of set.review.comments) if (comment.text.trim() !== '') counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1)
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
    this.explorer.review.render({ files, current: set.review.current ?? set.active, viewed: set.review.viewed, commentCounts: counts, commentTotal: total, note: set.review.note })
    if (updateCounts) this.syncAnnotations()
  }

  private async reviewOpen(path: string): Promise<void> {
    const set = this.set
    if (!set) return
    set.review.current = path
    await this.openFile(path, { pin: true })
    const doc = this.active()
    if (doc && doc.path === path && doc.status === 'ready' && !doc.changes && !doc.deleted) await doc.toggleChanges()
    this.renderReview()
  }

  private async reviewStep(direction: 1 | -1): Promise<void> {
    const set = this.set
    if (!set) return
    const files = this.reviewFiles()
    const current = files.findIndex((file) => file.path === (set.review.current ?? set.active))
    const next = stepReview(files.length, current, direction)
    if (next >= 0) await this.reviewOpen(files[next].path)
  }

  private toggleViewed(path: string, viewed: boolean): void {
    const set = this.set
    if (!set) return
    if (viewed) set.review.viewed.add(path)
    else set.review.viewed.delete(path)
    this.renderReview(false)
  }

  private sendReview(anchor: HTMLElement): void {
    const set = this.set
    if (!set) return
    const message = buildReviewMessage(set.review.comments, set.review.note, set.prefix)
    const note = set.review.note.trim()
    const body = message || (note ? `Review note: ${note}` : '')
    if (!body) return
    const sessions = this.liveSessions()
    const count = set.review.comments.filter((comment) => comment.text.trim() !== '').length
    const send = (paneId: string, title: string): void => {
      if (insertIntoSession(paneId, body)) toast(`Added ${count > 0 ? `${count} comment${count === 1 ? '' : 's'}` : 'your note'} to ${title}. Press Enter there to send it.`, 'info')
    }
    if (sessions.length === 0) {
      toast('Open a session to send review comments to.', 'info')
      return
    }
    if (sessions.length === 1) {
      send(sessions[0].paneId, sessions[0].title)
      return
    }
    const box = anchor.getBoundingClientRect()
    openContextMenu({
      x: box.left, y: box.top, label: 'Send comments to', returnFocus: anchor,
      entries: [{ heading: 'Send to session' }, ...sessions.map((session) => ({ label: session.title, run: () => send(session.paneId, session.title) }))]
    })
  }

  private sendProblems(text: string, anchor: HTMLElement): void {
    const sessions = this.liveSessions()
    const send = (paneId: string, title: string): void => {
      if (insertIntoSession(paneId, text)) toast(`Added to ${title}. Press Enter there to send it.`, 'info')
    }
    if (sessions.length === 0) {
      toast('Open a session to send problems to.', 'info')
      return
    }
    if (sessions.length === 1) {
      send(sessions[0].paneId, sessions[0].title)
      return
    }
    const box = anchor.getBoundingClientRect()
    openContextMenu({
      x: box.left, y: box.top, label: 'Send problems to', returnFocus: anchor,
      entries: [{ heading: 'Send to session' }, ...sessions.map((session) => ({ label: session.title, run: () => send(session.paneId, session.title) }))]
    })
  }

  private sessionForDraft(paths: readonly string[]): string | null {
    let best: { title: string; edits: number } | null = null
    const totals = new Map<string, { title: string; edits: number }>()
    for (const path of paths) {
      for (const session of this.touches.get(path) ?? []) {
        const known = totals.get(session.paneId) ?? { title: session.title, edits: 0 }
        totals.set(session.paneId, { ...known, edits: known.edits + session.edits })
      }
    }
    for (const entry of totals.values()) if (!best || entry.edits > best.edits) best = entry
    return best?.title ?? orderSessions([...this.touches.values()].flat())[0]?.title ?? null
  }

  private async commitChanges(): Promise<void> {
    const set = this.set
    if (!set) return
    const files = this.reviewFiles()
    if (files.length === 0) return
    const hash = await commitDialog({
      folder: set.folder,
      files,
      draft: draftCommitMessage({ sessionTitle: this.sessionForDraft(files.map((file) => file.path)), paths: files.map((file) => file.path) })
    })
    if (!hash) return
    toast(`Committed ${hash}`, 'info')
    await this.loadTree()
    this.checkOpenDocs()
    for (const doc of set.docs.values()) void doc.refreshStat()
  }

  private async discardFile(path: string): Promise<void> {
    const set = this.set
    if (!set) return
    const name = baseName(path)
    const entry = this.statusFiles.find((file) => file.path === path)
    const confirmed = await confirmDialog({
      title: `Discard changes to ${name}?`,
      body: `${path}\n${entry?.untracked ? 'This file is new, so discarding deletes it.' : 'The file goes back to its last commit.'}\nThis cannot be undone.`,
      confirmLabel: `Discard ${name}`
    })
    if (!confirmed) return
    const result = await api.gitDiscard({ folder: set.folder, paths: [path] }).catch((error: Error) => ({ ok: false as const, error: error.message }))
    if (!result.ok) {
      toast(result.error)
      return
    }
    set.review.comments = set.review.comments.filter((comment) => comment.path !== path)
    toast(`Discarded changes to ${name}`, 'info')
    await this.loadTree()
    this.checkOpenDocs([path])
  }

  private addComment(doc: FileDoc, line: number): void {
    const set = this.set
    if (!set) return
    set.review.comments = [...set.review.comments, { id: crypto.randomUUID(), path: doc.path, line, text: '', editing: true }]
    this.afterCommentChange()
  }

  private updateComment(id: string, change: (comment: DraftComment) => DraftComment | null): void {
    const set = this.set
    if (!set) return
    set.review.comments = set.review.comments.flatMap((comment) => {
      if (comment.id !== id) return [comment]
      const next = change(comment)
      return next ? [next] : []
    })
    this.afterCommentChange()
  }

  private afterCommentChange(): void {
    this.renderReview()
  }

  private async deleteComment(id: string): Promise<void> {
    const comment = this.set?.review.comments.find((candidate) => candidate.id === id)
    if (!comment) return
    const confirmed = await confirmDialog({
      title: 'Delete this comment?',
      body: `${comment.path}:${comment.line}\n${comment.text}`,
      confirmLabel: `Delete comment on line ${comment.line}`
    })
    if (confirmed) this.updateComment(id, () => null)
  }

  private blameFor(doc: FileDoc): ReadonlyMap<number, ReturnType<typeof blameLines> extends Map<number, infer V> ? V : never> {
    const sources: BlameSource[] = (this.touches.get(doc.path) ?? []).map((session) => ({ key: session.paneId, label: session.title, agent: session.agent, edits: session.records }))
    return blameLines(doc.addedLines(), sources)
  }

  private syncAnnotations(): void {
    const doc = this.active()
    const set = this.set
    if (!doc || !set || doc.status !== 'ready') return
    const comments = set.review.comments.filter((comment) => comment.path === doc.path)
    const blame = doc.changes ? this.blameFor(doc) : new Map()
    const signature = `${doc.changes}|${JSON.stringify(comments)}|${JSON.stringify([...blame.entries()])}`
    if (this.annotationSignature.get(doc) === signature) return
    this.annotationSignature.set(doc, signature)
    if (!doc.changes) {
      doc.annotate([])
      return
    }
    doc.annotate(reviewExtension({
      comments, blame,
      onAdd: (line) => this.addComment(doc, line),
      onEdit: (id) => this.updateComment(id, (comment) => ({ ...comment, editing: true })),
      onSave: (id, text) => this.updateComment(id, (comment) => (text.trim() === '' ? null : { ...comment, text: text.trim(), editing: false })),
      onCancel: (id) => this.updateComment(id, (comment) => (comment.text.trim() === '' ? null : { ...comment, editing: false })),
      onDelete: (id) => void this.deleteComment(id)
    }))
  }

  private async copyText(text: string, done: string): Promise<void> {
    try {
      await api.writeClipboard(text)
      this.setFlash(done)
    } catch {
      toast('Could not copy to the clipboard.')
    }
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
      case 'toggle': return this.explorer.tree.toggleFolder(path)
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
      const affected = [...set.docs.values()].filter((doc) => doc.path === path || (kind === 'folder' && doc.path.startsWith(`${path}/`)))
      const dirty = affected.filter((doc) => doc.dirty)
      const destination = navigator.platform.startsWith('Win') ? 'Recycle Bin' : 'Trash'
      const confirmed = await confirmDialog({
        title: `Move ${kind} to ${destination}?`,
        body: `${pathForms(set.folder, set.prefix, path).relative}${kind === 'folder' ? '\nThis includes the folder and everything inside it.' : ''}\n${dirty.length ? `Unsaved changes will be discarded in:\n${dirty.map((doc) => doc.path).join('\n')}\n` : ''}Move to ${destination}?`,
        confirmLabel: dirty.length ? `Discard changes and move to ${destination}` : `Move to ${destination}`
      })
      if (!confirmed) return
      toast(`Moving ${pathForms(set.folder, set.prefix, path).relative} to ${destination}…`, 'info')
      const result = await api.trashProjectPath(set.folder, pathForms(set.folder, set.prefix, path).relative).catch((error: Error) => ({ ok: false as const, error: error.message }))
      if (!result.ok) { toast(result.error); return }
      for (const doc of affected) { doc.destroy(); set.docs.delete(doc.path) }
      set.tabs = set.tabs.filter((tab) => tab.path !== path && !(kind === 'folder' && tab.path.startsWith(`${path}/`)))
      if (!set.tabs.some((tab) => tab.path === set.active)) set.active = set.tabs[0]?.path ?? null
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
        void this.activateTarget({ projectId: set.projectId, folder: set.folder }).then((active) => {
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
    const content = target.closest('.cm-content')
    const typing = target.closest('input, textarea, select') !== null || (content !== null && content.getAttribute('aria-readonly') !== 'true')
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
    if (plain && this.explorer.currentMode() === 'review' && (event.key.toLowerCase() === 'n' || event.key.toLowerCase() === 'p') && !typing && !this.active()?.editing) {
      event.preventDefault()
      event.stopPropagation()
      void this.reviewStep(event.key.toLowerCase() === 'n' ? 1 : -1)
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
    const signature = `${doc.path}|${doc.status}|${doc.dirty}|${doc.editing}|${doc.changes}|${doc.conflict}|${doc.gone}|${doc.noRepo}|${doc.deleted}|${doc.stat?.added}|${doc.stat?.removed}|${doc.newFile}|${doc.previewing}`
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
    this.worktreeNote.hidden = !this.watchFailed
  }

  private renderAll(): void {
    this.renderTabs()
    this.renderBar()
    this.renderStage()
    this.renderStatus()
    this.renderTouches()
    this.renderOutline()
    this.renderReview()
  }

  private renderTouches(): void {
    const rows = [...this.touches.entries()]
      .map(([path, sessions]) => ({ path, sessions: orderSessions(sessions.filter((session) => session.edits > 0)).map((session) => session.title) }))
      .filter((row) => row.sessions.length > 0)
      .sort((a, b) => a.path.localeCompare(b.path))
    this.explorer.setOpenInSessions(rows)
    this.renderActivity()
    this.syncAnnotations()
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
      } }, icon('<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>')))
    }))
  }

  private renderBar(): void {
    const doc = this.active()
    const ready = doc?.status === 'ready'
    this.bar.render({
      path: doc?.path ?? null,
      canDiff: !!doc && ready && !doc.deleted && !doc.noRepo,
      changes: doc?.changes ?? false,
      added: doc?.stat?.added ?? null,
      removed: doc?.stat?.removed ?? null,
      editing: doc?.editing ?? false,
      canPreview: !!doc && doc.canPreview,
      previewing: (doc?.previewing ?? false) && !doc?.changes,
      hasSource: ready,
      inspectorOpen: filesLayout().inspector.open,
      inspectorFits: this.fits.matches,
      deletedName: doc?.deleted ? doc.path : null
    })
    if (!doc) return
    this.conflict.hidden = !doc.conflict
    this.conflictText.textContent = doc.gone ? 'This file was deleted on disk.' : 'This file changed on disk.'
    this.reloadButton.hidden = doc.gone
    this.keepButton.textContent = doc.gone ? 'Keep mine (recreate)' : 'Keep mine (overwrite)'
  }

  private previewing(doc: FileDoc | null): boolean {
    if (!doc || !doc.canPreview || !doc.previewing || doc.changes) return false
    return doc.status === 'ready' || doc.previewKind === 'image'
  }

  private renderStage(): void {
    const set = this.set
    const doc = this.active()
    const showPreview = this.previewing(doc)
    for (const saved of this.sets.values()) for (const known of saved.docs.values()) known.show(saved === set && known === doc && known.status === 'ready' && !showPreview)
    if (!set) {
      this.preview.hide()
      this.showPlaceholder('Add a project to browse its files.')
      return
    }
    if (!doc) {
      this.preview.hide()
      this.showPlaceholder('Pick a file from the tree, or press Ctrl+P to find one.')
      return
    }
    if (showPreview && doc.previewKind) {
      this.empty.hidden = true
      const letter = this.statusFiles.find((file) => file.path === doc.path)
      this.preview.render({ kind: doc.previewKind, folder: set.folder, path: doc.path, text: doc.previewKind === 'image' && doc.status !== 'ready' ? '' : doc.text(), changed: this.isGit && letter !== undefined && !letter.untracked })
      return
    }
    this.preview.hide()
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
    const checkout = this.currentCheckout()
    const running = runningSummary(this.runPanel.runList, this.target?.folder ?? null)
    const runEl = running ? h('span', { class: 'files-status-run', id: 'files-status-run', title: 'A run command is running in this checkout' }, runningText(running)) : null
    this.status.hidden = !doc && !checkout && !running
    if (!doc) {
      this.status.replaceChildren(...(runEl ? [runEl] : []), h('span', { class: 'spacer' }), ...(checkout ? [h('span', { title: checkout.folder }, checkoutLabel(checkout))] : []))
      return
    }
    const cursor = doc.editor && doc.status === 'ready' ? doc.editor.cursor() : null
    const left = [cursor ? `Ln ${cursor.line}, Col ${cursor.col}` : null, languageLabel(doc.path)].filter(Boolean).join('  ·  ')
    let mode = 'Read only · press E to edit'
    if (doc.deleted) mode = 'Deleted since main'
    else if (doc.changes) mode = 'Showing changes since main'
    else if (this.previewing(doc)) mode = 'Preview'
    else if (doc.editing) mode = doc.dirty ? 'Editing · unsaved · Ctrl+S to save' : 'Editing · Ctrl+S to save'
    else if (doc.status !== 'ready') mode = ''
    const stat = doc.stat
    const statEl = stat
      ? h('span', { class: 'files-stat' }, h('span', { class: 'plus' }, `+${stat.added}`), ' ', h('span', { class: 'minus' }, `−${stat.removed}`), doc.newFile ? ' new file' : ' since main')
      : null
    this.status.replaceChildren(h('span', {}, left), h('span', { class: 'files-status-mode' }, this.flash || mode), h('span', { class: 'spacer' }), ...(runEl ? [runEl] : []), ...(checkout ? [h('span', { title: checkout.folder }, checkoutLabel(checkout))] : []), ...(statEl ? [statEl] : []), ...(this.watchFailed ? [this.worktreeNote] : []))
  }

  private renderActivity(): void {
    const doc = this.active()
    const set = this.set
    const sessions = doc ? this.touches.get(doc.path) ?? [] : []
    const commits = doc && set ? this.commits.get(`${set.folder}|${doc.path}`) ?? null : null
    this.inspector.renderActivity(!!doc, sessions, commits)
    if (doc && set && commits === null && filesLayout().inspector.tab === 'activity') void this.loadCommits()
  }

  private renderOutline(): void {
    const doc = this.active()
    this.inspector.renderOutline(doc?.status === 'ready' ? doc.outline() : [], !!doc)
  }
}
