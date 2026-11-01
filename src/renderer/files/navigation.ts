import type { CodeNavHit, CodeNavKind, CodeNavStatus } from '../../shared/codeNav'
import { toProjectPath, toRepoPath } from '../../shared/projectPaths'
import { quickOpen as rankFiles } from '../../shared/fileTree'
import { api } from '../api'
import { requestCodeNav, requestInstall, requestRestart, requestStatus } from './codeNavApi'
import { LatestGate } from './asyncGuard'
import type { FileDoc } from './fileDoc'
import type { FileEditor } from './editor'
import { openInVsCode } from './filesActions'
import { fileIndex, recentFiles } from './fileIndex'
import { closeJumpPick, openJumpPick, type PickItem } from './jumpPick'
import { enclosingSymbols, filterOutline, parseLineInput } from './jumpInputs'
import { EMPTY_HISTORY, forgetPath, recordJump, stepBack, stepForward, type NavHistory, type NavPoint, type Step } from './navHistory'
import { engineLine, NO_NAME_TEXT, planNavigation, type EngineLine } from './navOutcome'
import type { OutlineItem } from './outline'
import type { PeekHit } from './peek'
import { relocateHit } from './relocate'

export interface NavHost {
  folder(): string | null
  /** The project's place in its repository: file tabs use repo paths, the engine uses project paths. */
  prefix(): string
  active(): FileDoc | null
  /** Opens a file in a preview tab and loads it. Null when it could not be opened (every tab has unsaved edits). */
  open(path: string): Promise<FileDoc | null>
  /** A short note in the status bar. */
  say(text: string): void
  warn(text: string): void
  /** The navigator's state (Back, Forward, engine) changed: redraw the bar and status. */
  changed(): void
  dark(): boolean
  /** Where pickers appear. */
  overlay(): HTMLElement
  /** The text of a file for the peek: the open buffer when there is one, else the saved file. */
  text(path: string): Promise<string | null>
}

const POLL_MS = 2000
const POLL_MAX = 45
const EVERYTHING_FILES = 6
const EVERYTHING_SYMBOLS = 6
const EVERYTHING_TEXT = 8
const NAME_ONLY = /^[A-Za-z_$][\w$]*$/
const INSTALL_NOTE = 'Installing csharp-ls with dotnet tool install. Results get exact when the solution has loaded.'

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const dirName = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** Go to Definition, Implementation and References, Back and Forward, and the pickers that jump around a project. */
export class CodeNavigator {
  private history: NavHistory = EMPTY_HISTORY
  private engine: CodeNavStatus | null = null
  private readonly requestGate = new LatestGate()
  private readonly moveGate = new LatestGate()
  private readonly engineGate = new LatestGate()
  private pollTimer: number | undefined
  private polls = 0

  constructor(private readonly host: NavHost) {}

  get canBack(): boolean {
    return this.history.back.length > 0
  }

  get canForward(): boolean {
    return this.history.forward.length > 0
  }

  // The active file

  private editorOf(doc: FileDoc | null): FileEditor | null {
    return doc && doc.status === 'ready' && !doc.host.hidden ? doc.editor : null
  }

  private here(): NavPoint | null {
    const doc = this.host.active()
    return doc?.editor ? { path: doc.path, pos: doc.editor.cursorPos() } : null
  }

  symbols(): OutlineItem[] {
    return this.host.active()?.outline() ?? []
  }

  /** The class and method the caret is in, for the breadcrumbs. */
  breadcrumb(): OutlineItem[] {
    const editor = this.host.active()?.editor
    return editor ? enclosingSymbols(editor.outline(), editor.cursor().line) : []
  }

  // Go to Definition, Implementation, References

  async go(kind: CodeNavKind): Promise<void> {
    const doc = this.host.active()
    const editor = this.editorOf(doc)
    const folder = this.host.folder()
    if (!doc || !editor || !folder) return
    editor.clearInline()
    const found = editor.identifierAt(editor.cursorPos())
    if (!found) return this.bubble(doc, NO_NAME_TEXT, '', null)
    const cursor = editor.cursor()
    const ticket = this.requestGate.begin()
    const result = await requestCodeNav(folder, {
      kind, path: toProjectPath(this.host.prefix(), doc.path), symbol: found.name, line: cursor.line, column: cursor.col, unsavedText: doc.dirty ? doc.text() : undefined
    })
    if (!ticket.current() || this.host.active() !== doc || !doc.editor) return
    void this.refreshEngine()
    const plan = planNavigation(kind, found.name, result)
    if (plan.kind === 'jump') {
      if (plan.note) this.host.say(plan.note)
      await this.jumpToHit(plan.hit, found.name)
    } else if (plan.kind === 'peek') await this.peek(doc, found.name, plan.note ?? '', plan.hits)
    else this.bubble(doc, plan.text, found.name, plan.outside ? { label: 'Open in VS Code', run: () => openInVsCode(folder, doc.path, cursor.line) } : null)
  }

  /** Ctrl+click: the caret goes where the click was, then it is Go to Definition. */
  ctrlClick(doc: FileDoc, pos: number): void {
    if (doc !== this.host.active() || !doc.editor) return
    doc.editor.view.dispatch({ selection: { anchor: pos } })
    void this.go('definition')
  }

  private bubble(doc: FileDoc, text: string, symbol: string, action: { label: string; run(): void } | null): void {
    const editor = doc.editor
    if (!editor) return
    void import('./peek').then(({ buildBubble }) => {
      if (doc.editor !== editor) return
      editor.showInline(editor.cursor().line, () => buildBubble(text, symbol, action))
    })
  }

  private async peek(doc: FileDoc, symbol: string, note: string, hits: readonly CodeNavHit[]): Promise<void> {
    const editor = doc.editor
    if (!editor) return
    const prefix = this.host.prefix()
    const peekHits: PeekHit[] = hits.map((hit) => ({ ...hit, repoPath: toRepoPath(prefix, hit.path) }))
    const { buildPeek } = await import('./peek')
    if (doc.editor !== editor || this.host.active() !== doc) return
    const hooks = {
      open: (hit: PeekHit) => {
        editor.clearInline()
        void this.jumpToHit(hit, symbol)
      },
      close: () => this.dismiss(),
      text: (hit: PeekHit) => this.host.text(hit.repoPath),
      dark: () => this.host.dark()
    }
    editor.showInline(editor.cursor().line, (width) => buildPeek({ note, hits: peekHits }, hooks, width))
  }

  /** Esc: closes the peek or message under the caret. True when there was one. */
  dismiss(): boolean {
    const editor = this.host.active()?.editor
    if (!editor || editor.inlineLine() === null) return false
    editor.clearInline()
    editor.focus()
    return true
  }

  /** The caret moved off the line a peek sits under: it no longer belongs there. */
  cursorMoved(doc: FileDoc): void {
    const editor = doc.editor
    const line = editor?.inlineLine()
    if (editor && line != null && editor.cursor().line !== line) editor.clearInline()
  }

  // Moving

  private async travel(path: string, locate: (editor: FileEditor, target: FileDoc) => number, commit: (origin: NavPoint | null) => NavHistory): Promise<boolean> {
    const ticket = this.moveGate.begin()
    const origin = this.here()
    const target = await this.host.open(path)
    if (!ticket.current() || !target) return false
    await target.ensureLoaded()
    if (!ticket.current()) return false
    const editor = target.status === 'ready' ? target.editor : null
    if (!editor) {
      this.history = forgetPath(this.history, path)
      this.host.warn(`Could not open ${baseName(path)}.`)
      this.host.changed()
      return false
    }
    if (target.changes) await target.toggleChanges()
    if (target.previewing) target.setPreview(false)
    if (!ticket.current()) return false
    const pos = locate(editor, target)
    this.history = commit(origin)
    editor.jumpTo(pos)
    editor.flash(editor.cursor().line)
    this.host.changed()
    return true
  }

  private jumpToHit(hit: { path: string; line: number; column: number; preview: string }, symbol: string): Promise<boolean> {
    return this.travel(toRepoPath(this.host.prefix(), hit.path), (editor, target) => {
      const spot = target.dirty ? relocateHit(editor.view.state.sliceDoc(), hit, symbol) : hit
      return editor.posAt(spot.line, spot.column)
    }, (origin) => (origin ? recordJump(this.history, origin) : this.history))
  }

  private jumpToLine(path: string, line: number, column = 1): Promise<boolean> {
    return this.travel(path, (editor) => editor.posAt(line, column), (origin) => (origin ? recordJump(this.history, origin) : this.history))
  }

  private async step(move: (history: NavHistory, current: NavPoint) => Step | null): Promise<void> {
    const current = this.here()
    if (!current) return
    const step = move(this.history, current)
    if (!step) return
    await this.travel(step.to.path, (editor) => Math.min(step.to.pos, editor.view.state.doc.length), () => step.history)
  }

  back(): Promise<void> {
    return this.step(stepBack)
  }

  forward(): Promise<void> {
    return this.step(stepForward)
  }

  // Language service status

  engineLine(): EngineLine {
    return engineLine(this.engine)
  }

  /** Asks which language service serves the active file; checks again while it is starting. */
  async refreshEngine(): Promise<void> {
    window.clearTimeout(this.pollTimer)
    const doc = this.host.active()
    const folder = this.host.folder()
    if (!doc || !folder || doc.status !== 'ready') {
      this.setEngine(null)
      return
    }
    const ticket = this.engineGate.begin()
    const status = await requestStatus(folder, toProjectPath(this.host.prefix(), doc.path))
    if (!ticket.current()) return
    this.setEngine(status)
    if (status?.state === 'starting' && this.polls < POLL_MAX) {
      this.polls += 1
      this.pollTimer = window.setTimeout(() => void this.refreshEngine(), POLL_MS)
    } else this.polls = 0
  }

  private setEngine(status: CodeNavStatus | null): void {
    const before = JSON.stringify(this.engine)
    this.engine = status
    if (JSON.stringify(status) !== before) this.host.changed()
  }

  stop(): void {
    window.clearTimeout(this.pollTimer)
    this.engineGate.cancel()
    this.requestGate.cancel()
    this.moveGate.cancel()
    closeJumpPick()
  }

  async runEngineAction(): Promise<void> {
    const line = engineLine(this.engine)
    const doc = this.host.active()
    const folder = this.host.folder()
    if (!folder || !doc) return
    if (line.action === 'restart') {
      const failure = await requestRestart(folder, toProjectPath(this.host.prefix(), doc.path))
      if (failure) this.host.warn(failure)
    } else if (line.action === 'install') {
      this.host.say(INSTALL_NOTE)
      const result = await requestInstall()
      if (!result.ok) this.host.warn(result.error)
    }
    void this.refreshEngine()
  }

  // Pickers

  private focusEditor(): void {
    this.host.active()?.editor?.focus()
  }

  openSymbolPicker(): void {
    const doc = this.host.active()
    const editor = this.editorOf(doc)
    if (!doc || !editor) return
    const items = editor.outline()
    openJumpPick(this.host.overlay(), {
      ariaLabel: 'Go to symbol', placeholder: 'Go to a symbol in this file', restoreFocus: () => this.focusEditor(),
      items: (query) => filterOutline(items, query).map((item): PickItem => ({
        id: `${item.from}`, label: item.name, detail: String(item.line), indent: item.depth > 0, run: () => void this.jumpToLine(doc.path, item.line)
      })),
      empty: (query) => (query ? `No symbol matches "${query}".` : 'This file has no symbols.')
    })
  }

  openLinePicker(): void {
    const doc = this.host.active()
    const editor = this.editorOf(doc)
    if (!doc || !editor) return
    const total = editor.view.state.doc.lines
    openJumpPick(this.host.overlay(), {
      ariaLabel: 'Go to line', placeholder: `Line number, 1 to ${total}`, restoreFocus: () => this.focusEditor(),
      items: () => [],
      empty: (query) => (query && !parseLineInput(query, total) ? 'Type a line number.' : ''),
      submit: (query) => {
        const target = parseLineInput(query, total)
        if (target) void this.jumpToLine(doc.path, target.line, target.column ?? 1)
        return target !== null
      }
    })
  }

  openEverythingPicker(): void {
    const folder = this.host.folder()
    if (!folder) return
    openJumpPick(this.host.overlay(), {
      ariaLabel: 'Go to everything', placeholder: 'Find a file, a symbol or text', delayMs: 120, restoreFocus: () => this.focusEditor(),
      items: (query) => this.everything(folder, query),
      empty: (query) => (query ? 'Nothing matches that.' : 'No files yet.')
    })
  }

  private async everything(folder: string, query: string): Promise<PickItem[]> {
    const [files, symbols, text] = await Promise.all([this.fileItems(folder, query), this.symbolItems(folder, query), this.textItems(folder, query)])
    return [...files, ...symbols, ...text]
  }

  private async fileItems(folder: string, query: string): Promise<PickItem[]> {
    const index = await fileIndex(folder)
    return rankFiles(index.files, query, recentFiles(folder)).slice(0, EVERYTHING_FILES).map((path): PickItem => ({
      id: `file:${path}`, group: 'Files', label: baseName(path), detail: dirName(path), run: () => void this.jumpToLine(path, 1)
    }))
  }

  private async symbolItems(folder: string, query: string): Promise<PickItem[]> {
    const doc = this.host.active()
    if (query === '' || !doc) return []
    const here: PickItem[] = filterOutline(this.symbols(), query).slice(0, EVERYTHING_SYMBOLS).map((item) => ({
      id: `sym:${item.from}`, group: 'Symbols', label: item.name, detail: `${baseName(doc.path)}:${item.line}`, run: () => void this.jumpToLine(doc.path, item.line)
    }))
    if (!NAME_ONLY.test(query) || query.length < 2) return here
    const result = await requestCodeNav(folder, { kind: 'definition', path: toProjectPath(this.host.prefix(), doc.path), symbol: query, line: 1, column: 1 })
    const found = result.ok ? result.hits.slice(0, EVERYTHING_SYMBOLS) : []
    const defined: PickItem[] = found.map((hit) => ({
      id: `def:${hit.path}:${hit.line}`, group: 'Symbols', label: hit.preview || query, detail: `${baseName(hit.path)}:${hit.line}`, run: () => void this.jumpToHit(hit, query)
    }))
    return [...here, ...defined].slice(0, EVERYTHING_SYMBOLS)
  }

  private async textItems(folder: string, query: string): Promise<PickItem[]> {
    if (query.length < 2) return []
    const result = await api.searchFiles(folder, { query, matchCase: false, wholeWord: false, regex: false, include: '' }).catch(() => null)
    if (!result?.ok) return []
    return result.files.flatMap((file) => file.matches.map((match): PickItem => ({
      id: `text:${file.path}:${match.line}`, group: 'Text', label: match.text.trim(), detail: `${baseName(file.path)}:${match.line}`, run: () => void this.jumpToLine(file.path, match.line)
    }))).slice(0, EVERYTHING_TEXT)
  }
}
