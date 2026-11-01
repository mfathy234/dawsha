import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebContentsView, session, shell, type BrowserWindow, type Session } from 'electron'
import {
  BROWSER_PARTITION,
  CLOSED_BROWSER,
  MAX_CONSOLE_ERRORS,
  errorsMessage,
  isWebUrl,
  parseBrowserAddress,
  type BrowserBounds,
  type BrowserCapture,
  type BrowserErrors,
  type BrowserResult,
  type BrowserState
} from '../shared/browserPane'

const START_PAGE = 'about:blank'
const SHOT_DIR = 'dawsha-browser'

type Host = () => BrowserWindow | null

/** Locks a session down: nothing is granted, nothing downloads, and no certificate error is waved through. */
const locked = new WeakSet<Session>()

export function lockSession(target: Session): void {
  if (locked.has(target)) return
  locked.add(target)
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  target.setPermissionCheckHandler(() => false)
  target.setDevicePermissionHandler(() => false)
  target.on('will-download', (event) => event.preventDefault())
}

/**
 * One web page inside the Files panel, drawn by a native view over the placeholder the renderer reports.
 * It has no preload, no Node, a sandbox, its own in-memory session, and only http and https may load.
 */
export class BrowserPane {
  private view: WebContentsView | null = null
  private owner: BrowserWindow | null = null
  private errors: string[] = []
  private failure: string | null = null
  private bounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }
  private visible = false

  constructor(private readonly host: Host, private readonly changed: (state: BrowserState) => void) {}

  get isOpen(): boolean {
    return this.view !== null
  }

  state(): BrowserState {
    const contents = this.view?.webContents
    if (!this.view || !contents || contents.isDestroyed()) return CLOSED_BROWSER
    const url = contents.getURL()
    return {
      open: true,
      url: url === START_PAGE ? '' : url,
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      errorCount: this.errors.length,
      failure: this.failure
    }
  }

  open(address: string | null): BrowserResult {
    const window = this.host()
    if (!window || window.isDestroyed()) return { ok: false, error: 'The window is not ready.' }
    const parsed = address === null ? null : parseBrowserAddress(address)
    if (parsed && !parsed.ok) return { ok: false, error: parsed.error }
    if (!this.view) this.create(window)
    if (parsed?.ok) void this.load(parsed.url)
    return { ok: true, state: this.state() }
  }

  private create(window: BrowserWindow): void {
    const partition = session.fromPartition(BROWSER_PARTITION)
    lockSession(partition)
    const view = new WebContentsView({
      webPreferences: { partition: BROWSER_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, spellcheck: false }
    })
    this.view = view
    this.owner = window
    this.errors = []
    this.failure = null
    this.guard(view)
    view.setVisible(false)
    window.contentView.addChildView(view)
    this.applyBounds()
  }

  private guard(view: WebContentsView): void {
    const contents = view.webContents
    contents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    const events = contents as unknown as NodeJS.EventEmitter
    const refuse = (details: { url: string; preventDefault(): void }): void => {
      if (isWebUrl(details.url)) return
      details.preventDefault()
      this.failure = 'Only http and https addresses can be opened.'
      this.publish()
    }
    for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate']) events.on(name, refuse)
    contents.on('console-message', (event) => {
      if (event.level === 'error') this.record(`${event.message} (${event.sourceId || 'page'}:${event.lineNumber})`)
    })
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (code === -3) return
      this.record(`Failed to load ${url}: ${description}`)
      if (isMainFrame) this.failure = `Could not load this page: ${description}`
      this.publish()
    })
    for (const name of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated'] as const) {
      events.on(name, () => {
        if (name === 'did-start-loading') this.failure = null
        this.publish()
      })
    }
  }

  private record(line: string): void {
    this.errors = [...this.errors, line.slice(0, 500)].slice(-MAX_CONSOLE_ERRORS)
    this.publish()
  }

  private publish(): void {
    if (this.view) this.changed(this.state())
  }

  private async load(url: string): Promise<void> {
    this.errors = []
    this.failure = null
    try {
      await this.view?.webContents.loadURL(url)
    } catch {
      this.publish()
    }
  }

  navigate(address: string): BrowserResult {
    const parsed = parseBrowserAddress(address)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    if (!this.view) return this.open(address)
    void this.load(parsed.url)
    return { ok: true, state: this.state() }
  }

  setBounds(bounds: BrowserBounds, visible: boolean, zoom: number): void {
    const scale = zoom > 0 ? zoom : 1
    this.bounds = { x: Math.round(bounds.x * scale), y: Math.round(bounds.y * scale), width: Math.max(0, Math.round(bounds.width * scale)), height: Math.max(0, Math.round(bounds.height * scale)) }
    this.visible = visible
    this.applyBounds()
  }

  private applyBounds(): void {
    if (!this.view) return
    this.view.setBounds(this.bounds)
    this.view.setVisible(this.visible && this.bounds.width > 8 && this.bounds.height > 8)
  }

  command(type: 'back' | 'forward' | 'reload' | 'stop' | 'devtools'): BrowserResult {
    const contents = this.view?.webContents
    if (!contents || contents.isDestroyed()) return { ok: false, error: 'The browser is not open.' }
    if (type === 'back') contents.navigationHistory.goBack()
    else if (type === 'forward') contents.navigationHistory.goForward()
    else if (type === 'reload') contents.reload()
    else if (type === 'stop') contents.stop()
    else if (contents.isDevToolsOpened()) contents.closeDevTools()
    else contents.openDevTools({ mode: 'detach' })
    return { ok: true, state: this.state() }
  }

  async screenshot(): Promise<BrowserCapture> {
    const contents = this.view?.webContents
    if (!contents || contents.isDestroyed()) return { ok: false, error: 'The browser is not open.' }
    const image = await contents.capturePage()
    if (image.isEmpty()) return { ok: false, error: 'The page has nothing to capture yet.' }
    const folder = join(tmpdir(), SHOT_DIR)
    await mkdir(folder, { recursive: true })
    const path = join(folder, `page-${Date.now()}.png`)
    await writeFile(path, image.toPNG())
    return { ok: true, path, url: contents.getURL() }
  }

  consoleErrors(): BrowserErrors {
    if (!this.view) return { ok: false, error: 'The browser is not open.' }
    if (this.errors.length === 0) return { ok: false, error: 'The page has logged no errors.' }
    return { ok: true, text: errorsMessage(this.view.webContents.getURL(), this.errors), count: this.errors.length }
  }

  /** Removes the native view and closes its page. Safe to call twice. */
  close(): BrowserState {
    const view = this.view
    this.view = null
    if (view) {
      try {
        if (this.owner && !this.owner.isDestroyed()) this.owner.contentView.removeChildView(view)
      } catch {
        // the window may already be closing
      }
      if (!view.webContents.isDestroyed()) {
        if (view.webContents.isDevToolsOpened()) view.webContents.closeDevTools()
        view.webContents.close()
      }
    }
    this.owner = null
    this.errors = []
    this.failure = null
    this.visible = false
    return CLOSED_BROWSER
  }
}
