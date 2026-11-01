import { pathForms, tabMenu, treeMenu, type FileActionId, type FileMenuEntry } from '../../shared/fileMenus'
import { statusLetter } from '../../shared/gitStatus'
import { normalizeFolder } from '../../shared/folderKey'
import { branchName, checkoutLabel, checkoutTabsKey, type FilesCheckout } from '../../shared/filesWorkspace'
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
import { CodeNavigator } from '../files/navigation'
import { CodeTools } from '../files/codeTools'
import { neighbourFile } from '../files/changeStep'
import type { ToolsHost } from '../files/toolsHost'
import { marksForFile, openTarget } from '../files/problemMarks'
import { noteOpened } from '../files/fileIndex'
import { filesTarget, insertIntoSession, onFilesCommand, type FilesCommand, onFilesRequest, onFilesSearchRequest, openInVsCode, promptReference, setCurrentTarget, setDirtyProvider, takeFilesRequest, addToPrompt, type FilesTarget } from '../files/filesActions'
import { closeTab, openTab, pinTab, type TabRef } from '../files/filesState'
import { fileIcon } from '../files/fileIcon'
import { loadSessionData, orderSessions, type TouchMap } from '../files/sessionTouch'
import type { EditorTheme } from '../files/editor'
import { Explorer } from '../files/explorer'
import { FilesBar } from '../files/filesBar'
import { Inspector, type CommitsState } from '../files/inspector'
import { openCommitDetails } from '../files/commitDetails'
import { InFlight, LatestGate } from '../files/asyncGuard'
import { errorNote, loadingNote } from '../files/loadNote'
import { BottomPanel } from '../files/bottomPanel'
import { BrowserTab } from '../files/browserPane'
import { ConfigPane } from '../files/configPane'
import { PrPanel } from '../files/prPanel'
import { PreviewPane } from '../files/previewPane'
import { commitDialog } from '../files/commitDialog'
import { locationEntries, sendEntries } from '../files/locationMenu'
import { filesLayout, updateLayout } from '../files/filesPrefs'
import { reviewExtension, type DraftComment } from '../files/reviewEditor'
import type { TreeTarget } from '../files/filesTree'
import type { ReviewFile } from '../files/reviewPanel'
import { openContextMenu, type ContextEntry } from './contextMenu'
import { confirmDialog, promptDialog } from './dialogs'
import { ignoredToast, type UntrackedFolder } from '../../shared/gitIgnore'
import { openBranchSwitcher } from '../files/branchSwitcher'
import { toast } from './toast'
import { toggleQuickOpen } from './quickOpen'
import { RunCommandsPanel } from './runCommandsPanel'
import { pageHeader } from './pageHeader'
import './filesView.css'
import './filesTools.css'

const TOUCH_REFRESH_MS = 8000
const WATCH_DEBOUNCE_MS = 150
const FLASH_MS = 1600
const SESSION_START_WAIT_MS = 15_000
const SESSION_SETTLE_MS = 3000
const SESSION_QUIET_MS = 600
const MENU_WAIT_MS = 150
const FILE_LIMITS = 'Text files up to 1 MB open here. Images, Markdown and HTML also show as a preview.'

type CheckoutsRefresh = 'ok' | 'failed' | 'stale'

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
  private readonly openChecked = (path: string, line: number): void => {
    const target = openTarget(this.set?.prefix ?? '', path, line, undefined)
    void this.openFile(target.path, { pin: true, focus: true, line: target.line, column: target.column })
  }
  private readonly configPane = new ConfigPane({ folder: () => this.set?.folder ?? null, open: this.openChecked })
  private readonly prPanel = new PrPanel({ folder: () => this.set?.folder ?? null, open: this.openChecked, send: (text, anchor) => this.sendProblems(text, anchor) })
  private readonly browserTab = new BrowserTab({ send: (text, anchor) => this.sendProblems(text, anchor) })
  private readonly panel = new BottomPanel(this.runPanel, () => {
    // the panel reports while it is built, before the status bar below exists
    if (this.status === undefined) return
    this.renderStatus()
    this.syncProblems()
  }, {
    open: (path, line, column) => {
      const target = openTarget(this.set?.prefix ?? '', path, line, column)
      void this.openFile(target.path, { pin: true, focus: true, line: target.line, column: target.column })
    },
    send: (text, anchor) => this.sendProblems(text, anchor)
  }, [this.configPane, this.prPanel, this.browserTab])
  private visible = false
  private target: FilesTarget | null = null
  private readonly sets = new Map<string, DocSet>()
  private set: DocSet | null = null
  private touches: TouchMap = new Map()
  private touchTimer: number | undefined
  private readonly treeGate = new LatestGate()
  private readonly touchGate = new LatestGate()
  private readonly commitFlight = new InFlight<string>()
  private readonly commitErrors = new Set<string>()
  private touchesLoaded = false
  private loadedKey = ''
  /** The checkout a switch is still opening: the menu marks it as the choice, so picking the old one again cancels the switch. */
  private pending: FilesTarget | null = null
  private watchTimer: number | undefined
  private flashTimer: number | undefined
  private flash = ''
  private readonly lastSignature = new WeakMap<FileDoc, string>()
  private readonly annotationSignature = new WeakMap<FileDoc, string>()
  private watchFailed = false
  private readonly checkoutGate = new LatestGate()
  private readonly activationGate = new LatestGate()
  private deletionPending = false
  private checkouts: FilesCheckout[] = []
  private isGit = true
  private statusFiles: GitFileEntry[] = []
  private newFolders: UntrackedFolder[] = []
  private readonly newFolderGate = new LatestGate()
  private linked: LinkedRepo[] = []
  private linkedKey = ''
  private readonly commits = new Map<string, FileCommit[]>()
  private readonly fits = window.matchMedia(`(min-width: ${INSPECTOR_MIN_WIDTH}px)`)
  // The subtitle names the project and checkout shown, like the other pages' headers.
  private readonly header = pageHeader({ title: 'Files', subtitle: '' })
  private readonly worktreeNote = h('div', { class: 'files-worktree', id: 'files-live-note', role: 'status', hidden: true }, 'Live updates are off for this folder')
  private readonly explorer = new Explorer({
    tree: {
      open: (path, pin, focus) => void this.openFile(path, { pin, focus }),
      action: (id, target) => void this.runFileAction(id, target.path, target.kind),
      menu: (target, x, y, returnFocus) => this.openMenu(treeMenu(target.kind, target.open), target, x, y, returnFocus),
      retry: () => void this.retryTree()
    },
    search: {
      folder: () => this.target?.folder ?? null,
      run: (folder, request) => api.searchFiles(folder, request),
      open: (path, line) => void this.openFile(path, { pin: true, focus: true, line }),
      replace: (request, replacement) => void this.tools.replace(request, replacement)
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
      discard: (path) => void this.discardFile(path),
      ignoreFolder: (folder) => void this.ignoreFolder(folder),
      stale: () => void this.tools.stale()
    },
    goToFile: () => toggleQuickOpen(),
    openLocation: (button, worktreesFirst) => this.openLocationMenu(button, worktreesFirst),
    openBranches: (button) => void this.showBranchMenu(button),
    ignoreFolder: (folder) => void this.ignoreFolder(folder),
    hide: () => this.toggleExplorer(),
    retryChanges: () => void this.retryTree(),
    retryOpen: () => void this.refreshTouches(),
    rowMenu: (path, x, y, returnFocus) => openContextMenu({ x, y, label: 'File actions', entries: this.entriesFor(treeMenu('file', false), path, 'file'), returnFocus }),
    openRow: (path, pin) => void this.openFile(path, { pin, focus: false })
  })
  private readonly main = h('div', { class: 'files-main' })
  private readonly problemSignature = new WeakMap<FileDoc, string>()
  private readonly nav: CodeNavigator = new CodeNavigator({
    folder: () => this.target?.folder ?? null,
    prefix: () => this.set?.prefix ?? '',
    active: () => this.active(),
    open: (path) => this.openFile(path, { pin: false }),
    say: (text) => this.setFlash(text),
    warn: (text) => toast(text),
    changed: () => {
      this.renderBar()
      this.renderStatus()
    },
    dark: () => themeKind() === 'dark',
    overlay: () => this.main,
    text: (path) => this.textOf(path)
  })
  private readonly tools = new CodeTools(this.toolsHost())
  private readonly tabs = h('div', { class: 'files-tabs', role: 'tablist', 'aria-label': 'Open files' })
  private readonly bar = new FilesBar({
    showFile: () => void this.showFileMode(),
    showChanges: () => void this.toggleChanges(),
    setPreview: (on) => this.setPreview(on),
    done: () => this.toggleEdit(),
    send: (anchor) => this.openSendMenu(anchor),
    more: (anchor) => this.openMoreMenu(anchor),
    toggleInspector: () => this.toggleInspector(),
    toggleExplorer: () => this.toggleExplorer(),
    back: () => void this.nav.back(),
    forward: () => void this.nav.forward(),
    symbol: () => this.nav.openSymbolPicker(),
    setSideBySide: (on) => void this.active()?.setSideBySide(on)
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
    focusSession: (paneId) => focusPane(paneId),
    hide: () => this.toggleInspector(),
    retryCommits: () => this.retryCommits(),
    openCommit: (commit) => { if (this.set) void openCommitDetails(this.set.folder, commit, this.active()?.path ?? null) }
  })

  constructor() {
    this.stage.append(this.empty, this.preview.el)
    this.main.append(this.tabs, this.bar.el, this.conflict, this.stage, this.panel.el, this.status)
    this.el.append(this.header, this.explorer.el, this.main, this.inspector.el)
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
    onFilesCommand((command) => this.runCommand(command))
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
      if (doc !== this.active()) return
      this.renderOutline()
      this.renderBar()
    },
    goto: (doc, pos) => this.nav.ctrlClick(doc, pos),
    hover: (doc, pos) => this.tools.hover(doc, pos)
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
    if (request?.review) this.explorer.setMode('review')
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
    this.nav.stop()
    this.checkoutGate.cancel()
    this.activationGate.cancel()
    this.treeGate.cancel()
    this.touchGate.cancel()
    this.pending = null
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
    if (request.review) this.explorer.setMode('review')
  }

  private async activateTarget(requested: FilesTarget): Promise<boolean> {
    if (this.deletionPending) return false
    const ticket = this.activationGate.begin()
    this.pending = requested
    const requestedKey = checkoutTabsKey(requested.projectId, requested.folder)
    const replace = this.loadedKey !== requestedKey
    this.explorer.tree.setLoading(true, replace)
    if (replace) {
      this.explorer.setChanges([])
      this.explorer.setOpenInSessions([])
      this.explorer.setChangesStatus('loading')
      this.explorer.setOpenStatus('loading')
      this.touchesLoaded = false
    }
    const metadata = await api.filesWorkspaces(requested.projectId, requested.folder).catch(() => ({ ok: false as const, error: 'Could not open this checkout.' }))
    if (!ticket.current() || !this.visible || this.deletionPending) return false
    if (!metadata.ok) {
      this.pending = null
      this.explorer.tree.setLoading(false)
      this.explorer.setChangesStatus('ready')
      this.explorer.setOpenStatus('ready')
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
    if (!ticket.current() || !this.visible) return false
    this.loadedKey = requestedKey
    this.pending = null
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

  private async refreshCheckouts(): Promise<CheckoutsRefresh> {
    const target = this.target
    if (!target) return 'stale'
    const ticket = this.checkoutGate.begin()
    const result = await api.filesWorkspaces(target.projectId).catch(() => ({ ok: false as const, error: 'Could not refresh checkouts.' }))
    if (!ticket.current() || this.target !== target) return 'stale'
    if (!result.ok) return 'failed'
    this.checkouts = result.checkouts
    this.isGit = result.git
    if (!this.checkouts.some((entry) => normalizeFolder(entry.folder) === normalizeFolder(target.folder))) {
      this.checkouts.push({ folder: target.folder, branch: '', head: '', detached: false, unavailable: true, main: false })
    }
    this.renderLocation()
    this.renderStatus()
    return 'ok'
  }

  private currentCheckout(): FilesCheckout | undefined {
    const target = this.target
    return target ? this.checkouts.find((entry) => normalizeFolder(entry.folder) === normalizeFolder(target.folder)) : undefined
  }

  private renderLocation(): void {
    const target = this.target
    const project = target ? projectById(store.state, target.projectId) : undefined
    const checkout = this.currentCheckout()
    this.explorer.setLocation(project?.name ?? '', branchName(checkout, this.isGit), this.isGit ? this.checkouts.length : 0, target ? `${project?.name ?? ''}\n${target.folder}` : '')
    this.explorer.setTreeTitle(target ? folderTail(target.folder) : '')
  }

  // Menus

  private openLocationMenu(button: HTMLElement, worktreesFirst = false): void {
    void this.showLocationMenu(button, worktreesFirst)
  }

  private locationMenu(button: HTMLElement, worktreesFirst: boolean, worktrees: 'loading' | 'failed' | 'ready'): HTMLElement | null {
    const target = this.target
    if (!target) return null
    const project = projectById(store.state, target.projectId)
    const box = button.getBoundingClientRect()
    this.explorer.setLocationOpen(true, button)
    return openContextMenu({
      x: box.left, y: box.bottom + 2, label: 'Project and worktree', returnFocus: () => { this.explorer.setLocationOpen(false); button.focus() },
      entries: locationEntries({
        projects: store.state.settings.projects, projectId: this.pending?.projectId ?? target.projectId, projectName: project?.name ?? 'this project', folder: this.pending?.folder ?? target.folder, checkouts: this.checkouts, linked: this.linked,
        git: this.isGit, worktrees, worktreesFirst,
        retryWorktrees: () => void this.showLocationMenu(button, worktreesFirst),
        switchProject: (id) => this.switchProject(id),
        switchCheckout: (folder) => this.switchCheckout(folder),
        openLinked: (repo) => this.openLinked(repo),
        copyPath: () => void this.copyText(target.folder, 'Path copied'),
        reveal: () => void api.quickOpen('explorer', target.folder)
      })
    })
  }

  // The worktree list is read again every time the menu opens, so one added or removed outside Dawsha shows up.
  private async showLocationMenu(button: HTMLElement, worktreesFirst: boolean): Promise<void> {
    if (!this.target) return
    const pending = this.refreshCheckouts()
    const early = await Promise.race([pending, wait(MENU_WAIT_MS).then(() => 'pending' as const)])
    if (!this.target) return
    const menu = this.locationMenu(button, worktreesFirst, early === 'pending' ? 'loading' : early === 'failed' ? 'failed' : 'ready')
    this.watchMenuClose(() => this.explorer.setLocationOpen(false))
    if (early !== 'pending' || !menu) return
    const late = await pending
    if (!menu.isConnected || menu.classList.contains('leaving') || !this.target) return
    this.locationMenu(button, worktreesFirst, late === 'failed' ? 'failed' : 'ready')
  }

  private async showBranchMenu(anchor: HTMLElement): Promise<void> {
    const target = this.target
    if (!target || !this.isGit) {
      toast('This folder is not a git repository.')
      return
    }
    await openBranchSwitcher({
      folder: target.folder, anchor,
      open: (open) => this.explorer.setLocationOpen(open, open ? anchor : null),
      switched: () => void this.afterBranchSwitch(target)
    })
  }

  private async afterBranchSwitch(target: FilesTarget): Promise<void> {
    if (this.target !== target || !this.visible) return
    void this.refreshCheckouts()
    await this.loadTree()
    this.checkOpenDocs()
    void this.loadCommits()
    void this.refreshTouches()
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
      { label: 'Ask an agent about this…', run: () => void this.tools.ask() },
      { label: 'Follow the agent', current: this.tools.follows, run: () => this.tools.toggleFollow() },
      { label: 'Open in VS Code', run: () => this.openActiveInCode() },
      { label: 'Copy path', run: () => void this.runFileAction('copy-path', doc.path) },
      { label: 'Copy relative path', run: () => void this.runFileAction('copy-relative', doc.path) },
      { label: 'Reveal in File Explorer', run: () => void this.runFileAction('reveal', doc.path) },
      'separator',
      { label: `Delete ${baseName(doc.path)}…`, run: () => void this.runFileAction('delete', doc.path) }
    ]
    const box = anchor.getBoundingClientRect()
    this.bar.setMenuOpen('more', true)
    openContextMenu({ x: box.left, y: box.bottom + 2, anchor: box, label: 'More actions', entries, returnFocus: anchor })
    this.watchMenuClose(() => this.bar.setMenuOpen('more', false))
  }

  // Data

  private async loadTree(): Promise<void> {
    const target = this.target
    if (!target) return
    const ticket = this.treeGate.begin()
    const [listing, git] = await Promise.all([
      api.projectFiles(target.folder).catch((error: Error) => ({ ok: false as const, error: error.message })),
      api.gitStatus(target.folder).catch(() => null)
    ])
    if (!ticket.current()) return
    const status = new Map<string, string>()
    this.statusFiles = git?.ok ? git.status.files : []
    this.explorer.setChangesStatus(git === null || (!git.ok && this.isGit) ? 'error' : 'ready')
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
    void this.loadNewFolders(target)
  }

  // Folders of new files fold into one row. Reading their size can take a moment, so Changes shows the plain list first.
  private async loadNewFolders(target: FilesTarget): Promise<void> {
    const ticket = this.newFolderGate.begin()
    if (!this.statusFiles.some((file) => file.untracked)) {
      this.setNewFolders([])
      return
    }
    const result = await api.gitUntrackedFolders(target.folder).catch(() => null)
    if (!ticket.current() || this.target !== target) return
    this.setNewFolders(result?.ok ? result.folders : [])
  }

  private setNewFolders(folders: UntrackedFolder[]): void {
    const same = folders.length === this.newFolders.length && folders.every((folder, at) => JSON.stringify(folder) === JSON.stringify(this.newFolders[at]))
    this.newFolders = folders
    if (same) return
    this.explorer.setNewFolders(folders)
    this.renderReview(false)
  }

  private async ignoreFolder(folder: UntrackedFolder): Promise<void> {
    const target = this.target
    if (!target) return
    const result = await api.gitIgnoreAdd({ folder: target.folder, path: folder.path }).catch(() => ({ ok: false as const, error: 'Could not update the .gitignore.' }))
    if (!result.ok) {
      toast(result.error)
      return
    }
    toast(ignoredToast(folder.path), 'info')
    if (this.target === target) await this.loadTree()
  }

  private async retryTree(): Promise<void> {
    if (!this.target) return
    this.explorer.tree.setLoading(true, true)
    this.explorer.setChangesStatus('loading')
    await this.loadTree()
    this.explorer.tree.setLoading(false)
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
    const ticket = this.touchGate.begin()
    const data = await loadSessionData(target.projectId, target.folder, this.set?.prefix ?? '', others).catch(() => null)
    if (!ticket.current() || this.target !== target) return
    if (!data) {
      if (!this.touchesLoaded) this.explorer.setOpenStatus('error')
      return
    }
    this.touchesLoaded = true
    this.explorer.setOpenStatus('ready')
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

  /** Opens a file in a tab and loads it. Null when it could not be opened, such as when every tab has unsaved changes. */
  async openFile(path: string, options: { pin?: boolean; focus?: boolean; line?: number; column?: number } = {}): Promise<FileDoc | null> {
    if (this.deletionPending) return null
    const set = this.set
    if (!set) return null
    const result = openTab(set.tabs, path, options.pin === true, set.active, this.protectedPaths(set))
    if (!result) {
      toast('Close a tab first: every open file has unsaved changes.', 'info')
      return null
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
    if (!doc) return null
    await this.loadActive(doc)
    if (this.set !== set || set.active !== path) return null
    if (options.line && doc.editor) doc.editor.reveal(doc.editor.posAt(options.line, options.column ?? 1))
    if (options.focus) doc.editor?.focus()
    return doc
  }

  private async textOf(path: string): Promise<string | null> {
    const set = this.set
    const open = set?.docs.get(path)
    if (open?.editor && open.status === 'ready') return open.text()
    if (!set) return null
    const result = await api.projectFile(set.folder, path).catch(() => null)
    return result?.ok && result.text !== null ? result.text : null
  }

  private syncProblems(): void {
    const set = this.set
    const doc = this.active()
    if (!set || !doc || doc.status !== 'ready') return
    const marks = marksForFile(this.panel.problemList(), set.prefix, doc.path)
    const signature = JSON.stringify(marks)
    if (this.problemSignature.get(doc) === signature) return
    this.problemSignature.set(doc, signature)
    doc.setProblems(marks)
  }

  private async loadActive(doc: FileDoc): Promise<void> {
    await doc.ensureLoaded()
    this.renderAll()
    if (doc === this.active()) void this.nav.refreshEngine()
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
    if (doc) void this.loadActive(doc).then(() => (focusEditor && this.set === set && set.active === path ? doc.editor?.focus() : undefined))
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
    this.el.classList.toggle('no-explorer', !filesLayout().explorer.open)
    this.renderBar()
  }

  private toggleInspector(): void {
    const layout = updateLayout((current) => ({ ...current, inspector: { ...current.inspector, open: !current.inspector.open } }))
    this.applyInspector()
    if (!layout.inspector.open) this.bar.focusInspector()
  }

  private toggleExplorer(): void {
    const layout = updateLayout((current) => ({ ...current, explorer: { open: !current.explorer.open } }))
    this.applyInspector()
    if (layout.explorer.open) this.explorer.focusLocation()
    else this.bar.focusExplorer()
  }

  private runCommand(command: FilesCommand): void {
    if (!this.visible) return
    if (command === 'toggle-inspector') this.toggleInspector()
    else if (command === 'toggle-explorer') this.toggleExplorer()
    else if (command === 'definition' || command === 'implementation' || command === 'references') void this.nav.go(command)
    else if (command === 'back') void this.nav.back()
    else if (command === 'forward') void this.nav.forward()
    else if (command === 'everything') this.nav.openEverythingPicker()
    else if (command === 'symbol') this.nav.openSymbolPicker()
    else if (command === 'line') this.nav.openLinePicker()
    else if (command === 'ask') void this.tools.ask()
    else if (command === 'rename') {
      if (this.el.contains(document.activeElement)) void this.tools.rename()
    }
    else if (command === 'calls') this.tools.calls()
    else if (command === 'stale') void this.tools.stale()
    else if (command === 'follow') this.tools.toggleFollow()
    else if (command === 'next-problem' || command === 'previous-problem') this.stepProblem(command === 'next-problem' ? 1 : -1)
    else if (command === 'next-change' || command === 'previous-change') void this.stepChange(command === 'next-change' ? 1 : -1)
    else if (command === 'replace') this.explorer.setMode('search')
    else if (command === 'show-config') this.panel.show('config')
    else if (command === 'show-pr') this.panel.show('pr')
    else if (command === 'show-browser') this.panel.show('browser')
    else {
      if (!filesLayout().explorer.open) this.toggleExplorer()
      if (command === 'switch-branch') void this.showBranchMenu(this.explorer.branchesAnchor())
      else this.openLocationMenu(this.explorer.branchAnchor(), true)
    }
  }

  private stepProblem(direction: 1 | -1): void {
    const editor = this.active()?.editor
    if (editor && !editor.stepProblem(direction)) this.setFlash('This file has no problems marked.')
  }

  private setInspectorTab(tab: InspectorTab): void {
    updateLayout((layout) => ({ ...layout, inspector: { ...layout.inspector, tab } }))
    this.inspector.setTab(tab)
    if (tab === 'activity') void this.loadCommits()
  }

  private commitsKeyFor(doc: FileDoc | null, set: DocSet | null): string | null {
    return doc && set ? `${set.folder}|${doc.path}` : null
  }

  private async loadCommits(): Promise<void> {
    const doc = this.active()
    const set = this.set
    const key = this.commitsKeyFor(doc, set)
    if (!doc || !set || key === null || this.commits.has(key) || this.commitFlight.has(key)) return
    this.commitErrors.delete(key)
    await this.commitFlight.run(key, async () => {
      const result = await api.fileLog(set.folder, doc.path).catch(() => null)
      if (result?.ok) this.commits.set(key, result.commits)
      else this.commitErrors.add(key)
    })
    this.renderActivity()
  }

  private retryCommits(): void {
    const key = this.commitsKeyFor(this.active(), this.set)
    if (key === null) return
    this.commitErrors.delete(key)
    this.renderActivity()
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
    this.explorer.review.render({ newFolders: this.newFolders, files, current: set.review.current ?? set.active, viewed: set.review.viewed, commentCounts: counts, commentTotal: total, note: set.review.note })
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

  private toolsHost(): ToolsHost {
    return {
      folder: () => this.target?.folder ?? null,
      prefix: () => this.set?.prefix ?? '',
      active: () => this.active(),
      say: (text) => this.setFlash(text),
      warn: (text) => toast(text),
      dirtyPaths: () => [...(this.set?.docs.values() ?? [])].filter((doc) => doc.dirty).map((doc) => doc.path),
      changedOnDisk: (paths) => {
        void this.loadTree()
        this.checkOpenDocs(paths)
      },
      sessions: () => this.liveSessions(),
      openAt: async (path, line) => void (await this.openFile(path, { pin: true, focus: true, line })),
      text: (path) => this.textOf(path),
      overlay: () => this.main,
      refreshAnnotations: () => this.syncAnnotations(),
      followTo: (path) => void this.followTo(path)
    }
  }

  private async followTo(path: string): Promise<void> {
    await this.openFile(path, { pin: false })
    const doc = this.active()
    if (!doc || doc.path !== path || doc.status !== 'ready' || doc.deleted || doc.noRepo) return
    if (!doc.changes) await doc.toggleChanges()
    doc.editor?.stepChange(1, true)
    this.renderReview()
  }

  /** F7 and Shift+F7: the next or previous change; past the last one in a review pass, the next file's first. */
  private async stepChange(direction: 1 | -1): Promise<void> {
    const doc = this.active()
    const set = this.set
    if (!doc || !set || doc.status !== 'ready' || doc.deleted || doc.noRepo) return
    if (!doc.changes) {
      await doc.toggleChanges()
      doc.editor?.stepChange(direction, true)
      return
    }
    if (doc.editor?.stepChange(direction)) return
    const next = this.explorer.currentMode() === 'review' ? neighbourFile(this.reviewFiles().map((file) => file.path), set.review.current ?? set.active, direction) : null
    if (!next) return this.setFlash(direction === 1 ? 'That was the last change.' : 'That was the first change.')
    await this.reviewOpen(next)
    this.active()?.editor?.stepChange(direction, true)
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
    this.commits.clear()
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
    return blameLines(doc.addedLines(), sources, doc.text())
  }

  private syncAnnotations(): void {
    const doc = this.active()
    const set = this.set
    if (!doc || !set || doc.status !== 'ready') return
    const comments = set.review.comments.filter((comment) => comment.path === doc.path)
    if (doc.changes) this.tools.changes.load(doc)
    const blame = doc.changes && !this.tools.changes.hasLineSessions(doc) ? this.blameFor(doc) : new Map()
    const signature = `${doc.changes}|${JSON.stringify(comments)}|${JSON.stringify([...blame.entries()])}|${this.tools.changes.signature(doc)}`
    if (this.annotationSignature.get(doc) === signature) return
    this.annotationSignature.set(doc, signature)
    if (!doc.changes) {
      doc.annotate([])
      return
    }
    doc.annotate([this.tools.changes.extensions(doc), reviewExtension({
      comments, blame,
      onAdd: (line) => this.addComment(doc, line),
      onEdit: (id) => this.updateComment(id, (comment) => ({ ...comment, editing: true })),
      onSave: (id, text) => this.updateComment(id, (comment) => (text.trim() === '' ? null : { ...comment, text: text.trim(), editing: false })),
      onCancel: (id) => this.updateComment(id, (comment) => (comment.text.trim() === '' ? null : { ...comment, editing: false })),
      onDelete: (id) => void this.deleteComment(id)
    })])
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
      case 'open': return void (await this.openFile(path, { pin: true, focus: true }))
      case 'open-new-tab': return void (await this.openFile(path, { pin: true }))
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
    this.activationGate.cancel()
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
    if (target.closest('.nav-peek')) return
    if (event.key === 'Escape' && plain && this.nav.dismiss()) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
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
    if (plain && this.explorer.currentMode() === 'review' && event.key.toLowerCase() === 'v' && !typing && !this.active()?.editing) {
      event.preventDefault()
      event.stopPropagation()
      const path = this.set?.review.current ?? this.set?.active
      if (path) this.toggleViewed(path, !this.set?.review.viewed.has(path))
      this.explorer.review.focus()
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
    const signature = `${doc.path}|${doc.status}|${doc.dirty}|${doc.editing}|${doc.changes}|${doc.conflict}|${doc.gone}|${doc.noRepo}|${doc.deleted}|${doc.stat?.added}|${doc.stat?.removed}|${doc.newFile}|${doc.previewing}|${doc.sideBySide}`
    if (this.lastSignature.get(doc) === signature) return
    this.lastSignature.set(doc, signature)
    if (doc !== this.active()) this.renderTabs()
    else this.renderAll()
  }

  private cursorMoved(doc: FileDoc): void {
    if (doc !== this.active()) return
    this.nav.cursorMoved(doc)
    this.renderStatus()
    this.renderBar()
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
    this.syncProblems()
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
      explorerOpen: filesLayout().explorer.open,
      deletedName: doc?.deleted ? doc.path : null,
      canBack: this.nav.canBack,
      canForward: this.nav.canForward,
      symbols: ready ? this.nav.breadcrumb().map((item) => item.name) : [],
      sideBySide: doc?.sideBySide ?? false
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
      this.showLoading(`Opening ${baseName(doc.path)}…`)
      return
    }
    if (doc.status === 'missing') {
      this.showProblem(doc)
      return
    }
    this.showPlaceholder(doc.message, true, FILE_LIMITS)
  }

  private showLoading(text: string): void {
    if (!this.empty.hidden && this.empty.dataset.loading === text) return
    this.empty.hidden = false
    this.empty.dataset.loading = text
    this.empty.replaceChildren(loadingNote(text))
  }

  private showProblem(doc: FileDoc): void {
    delete this.empty.dataset.loading
    this.empty.hidden = false
    this.empty.replaceChildren(errorNote("Couldn't open this file.", () => void this.retryDoc(doc), doc.message))
  }

  private async retryDoc(doc: FileDoc): Promise<void> {
    await doc.retry()
    this.renderAll()
  }

  private showPlaceholder(text: string, withCode = false, detail = ''): void {
    delete this.empty.dataset.loading
    this.empty.hidden = false
    this.empty.replaceChildren(h('p', {}, text), ...(detail ? [h('p', { class: 'files-limits' }, detail)] : []), ...(withCode ? [h('button', { class: 'btn small', type: 'button', onClick: () => this.openActiveInCode() }, 'Open in VS Code')] : []))
  }

  private renderHeaderWhere(checkout: ReturnType<FilesViewComponent['currentCheckout']>): void {
    const subtitle = this.header.querySelector('.page-subtitle')
    if (!subtitle) return
    const project = this.target ? projectById(store.state, this.target.projectId) : null
    const text = project ? [project.name, checkout ? checkoutLabel(checkout) : null].filter(Boolean).join(' · ') : 'Pick a project to browse its files.'
    if (subtitle.textContent !== text) subtitle.textContent = text
  }

  private renderStatus(): void {
    const doc = this.active()
    const checkout = this.currentCheckout()
    this.renderHeaderWhere(checkout)
    const running = runningSummary(this.runPanel.runList, this.target?.folder ?? null)
    const runEl = running ? h('span', { class: 'files-status-run', id: 'files-status-run', title: 'A run command is running in this checkout' }, runningText(running)) : null
    this.status.hidden = !doc && !checkout && !running
    if (!doc) {
      this.status.replaceChildren(...(runEl ? [runEl] : []), h('span', { class: 'spacer' }), ...(checkout ? [h('span', { title: checkout.folder }, checkoutLabel(checkout))] : []))
      return
    }
    const cursor = doc.editor && doc.status === 'ready' ? doc.editor.cursor() : null
    const position = cursor
      ? h('button', { class: 'files-status-pos', id: 'files-status-pos', type: 'button', title: 'Go to line (Ctrl+G)', onClick: () => this.nav.openLinePicker() }, `Ln ${cursor.line}, Col ${cursor.col}`)
      : null
    const left = h('span', {}, ...(position ? [position, '  ·  '] : []), languageLabel(doc.path))
    const engine = this.nav.engineLine()
    const engineEl = engine.text
      ? h('span', { class: 'files-status-engine', id: 'files-status-engine' }, engine.text, ...(engine.action ? [' ', h('button', { class: 'files-status-link', type: 'button', onClick: () => void this.nav.runEngineAction() }, engine.actionLabel)] : []))
      : null
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
    this.status.replaceChildren(left, h('span', { class: 'files-status-mode' }, this.flash || mode), h('span', { class: 'spacer' }), ...(engineEl ? [engineEl] : []), ...(runEl ? [runEl] : []), ...(checkout ? [h('span', { title: checkout.folder }, checkoutLabel(checkout))] : []), ...(statEl ? [statEl] : []), ...(this.watchFailed ? [this.worktreeNote] : []))
  }

  private renderActivity(): void {
    const doc = this.active()
    const set = this.set
    const sessions = doc ? this.touches.get(doc.path) ?? [] : []
    const key = this.commitsKeyFor(doc, set)
    const commits: CommitsState = key === null ? null : this.commits.get(key) ?? (this.commitErrors.has(key) ? 'error' : null)
    this.inspector.renderActivity(!!doc, sessions, commits, !this.touchesLoaded)
    if (key !== null && commits === null && filesLayout().inspector.tab === 'activity') void this.loadCommits()
  }

  private renderOutline(): void {
    const doc = this.active()
    this.inspector.renderOutline(doc?.status === 'ready' ? doc.outline() : [], !!doc, doc?.status === 'idle' || doc?.status === 'loading')
  }
}
