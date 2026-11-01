import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { validBounds, type BrowserCommand, type BrowserResult } from '../shared/browserPane'
import { TOOLS_IPC } from '../shared/filesTools'
import type { PrRequest } from '../shared/prFlow'
import { BrowserPane } from './browserPane'
import { readProjectConfig, revealProjectConfig } from './configFiles'
import { knownProjectFolder } from './knownFolder'
import { runPrFlow } from './prFlow'

interface ToolsStore {
  get(): { projects: ReadonlyArray<{ folder: string }> }
}

const NOT_PROJECT = 'This folder is not one of your projects.'
const refusedBrowser: BrowserResult = { ok: false, error: 'The browser is only available in the application window.' }

function fromAppWindow(window: BrowserWindow | null, event: IpcMainInvokeEvent): boolean {
  return !!window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
}

/** Config, pull request and browser handlers for the Files panel. Returns a function that closes the browser. */
export function registerToolsIpc(getWindow: () => BrowserWindow | null, store: ToolsStore): () => void {
  const pane = new BrowserPane(getWindow, (state) => {
    const window = getWindow()
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(TOOLS_IPC.browserState, state)
  })
  const known = (folder: unknown): Promise<string | null> => knownProjectFolder(store.get().projects, folder)
  const watched = new WeakSet<object>()

  function closeWithPage(window: BrowserWindow): void {
    if (watched.has(window)) return
    watched.add(window)
    window.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) pane.close()
    })
    window.on('closed', () => pane.close())
  }

  const guarded = <A extends unknown[], R>(refusal: R, run: (...args: A) => R | Promise<R>) => (event: IpcMainInvokeEvent, ...args: A): R | Promise<R> =>
    fromAppWindow(getWindow(), event) ? run(...args) : refusal

  ipcMain.handle(TOOLS_IPC.configRead, guarded<[unknown], unknown>({ ok: false, error: NOT_PROJECT }, async (folder) => {
    const root = await known(folder)
    return root ? readProjectConfig(root) : { ok: false, error: NOT_PROJECT }
  }))
  ipcMain.handle(TOOLS_IPC.configReveal, guarded<[{ folder?: unknown }], unknown>({ ok: false, error: NOT_PROJECT }, async (request) => {
    const root = await known(request?.folder)
    return root ? revealProjectConfig(root, request as never) : { ok: false, error: NOT_PROJECT }
  }))
  ipcMain.handle(TOOLS_IPC.pr, guarded<[PrRequest], unknown>({ ok: false, error: NOT_PROJECT }, async (request) => {
    const root = await known(request?.folder)
    if (!root) return request?.action === 'overview' ? { ok: false, reason: 'failed', message: NOT_PROJECT } : { ok: false, error: NOT_PROJECT }
    return runPrFlow({ ...request, folder: root })
  }))
  ipcMain.handle(TOOLS_IPC.browser, guarded<[BrowserCommand], BrowserResult>(refusedBrowser, (command) => runBrowser(command)))
  ipcMain.handle(TOOLS_IPC.browserShot, guarded<[], unknown>(refusedBrowser, () => pane.screenshot()))
  ipcMain.handle(TOOLS_IPC.browserErrors, guarded<[], unknown>(refusedBrowser, () => pane.consoleErrors()))

  function runBrowser(command: BrowserCommand): BrowserResult {
    const window = getWindow()
    if (!command || typeof command !== 'object') return refusedBrowser
    if (command.type === 'open') {
      if (window) closeWithPage(window)
      return pane.open(typeof command.url === 'string' ? command.url : null)
    }
    if (command.type === 'navigate') return pane.navigate(command.url)
    if (command.type === 'bounds') {
      if (!validBounds(command.bounds)) return { ok: false, error: 'Those bounds are not valid.' }
      pane.setBounds(command.bounds, command.visible === true, window?.webContents.getZoomFactor() ?? 1)
      return { ok: true, state: pane.state() }
    }
    if (command.type === 'close') return { ok: true, state: pane.close() }
    if (['back', 'forward', 'reload', 'stop', 'devtools'].includes(command.type)) return pane.command(command.type as 'back')
    return { ok: false, error: 'Unknown browser command.' }
  }

  return () => {
    pane.close()
  }
}
