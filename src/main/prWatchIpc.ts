import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { PR_WATCH_IPC, isPrWatchTarget, type PrFixResult, type PrMergeResult, type PrTidyRequest, type PrTidyResult, type PrWatchCheck, type PrWatchTarget } from '../shared/prWatch'
import { runGh } from './ghRunner'
import { knownProjectFolder } from './knownFolder'
import { PrWatcher } from './prWatcher'
import { buildFixMessage, mergeWatched } from './prWatchTasks'
import { removeWorktreeSafely } from './worktreeSafeRemove'

interface WatchStore {
  get(): { projects: ReadonlyArray<{ folder: string }> }
}

const NOT_PROJECT = 'This folder is not one of your projects.'

const fromAppWindow = (window: BrowserWindow | null, event: Electron.IpcMainEvent | IpcMainInvokeEvent): boolean =>
  !!window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame

/** Watches the pull requests of the open sessions and runs Fix CI, merge and tidy-up for them. Returns a function that stops polling. */
export function registerPrWatchIpc(getWindow: () => BrowserWindow | null, store: WatchStore): () => void {
  const known = (folder: unknown): Promise<string | null> => knownProjectFolder(store.get().projects, folder)
  const watcher = new PrWatcher({
    runGh,
    now: () => Date.now(),
    visible: () => {
      const window = getWindow()
      return !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized()
    },
    emit: (update) => {
      const window = getWindow()
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(PR_WATCH_IPC.update, update)
    },
    known
  })
  watcher.start()

  ipcMain.on(PR_WATCH_IPC.sync, (event, targets: unknown) => {
    if (!fromAppWindow(getWindow(), event) || !Array.isArray(targets)) return
    void watcher.sync(targets.filter(isPrWatchTarget) as PrWatchTarget[])
  })
  ipcMain.on(PR_WATCH_IPC.refresh, (event, key: unknown) => {
    if (fromAppWindow(getWindow(), event) && typeof key === 'string') watcher.refresh(key)
  })
  ipcMain.handle(PR_WATCH_IPC.fixCi, async (event, folder: unknown, state: { number?: unknown; failed?: unknown }): Promise<PrFixResult> => {
    if (!fromAppWindow(getWindow(), event)) return { ok: false, error: NOT_PROJECT }
    const root = await known(folder)
    if (!root) return { ok: false, error: NOT_PROJECT }
    const failed = Array.isArray(state?.failed) ? (state.failed as PrWatchCheck[]).filter((check) => check && typeof check.name === 'string') : []
    return buildFixMessage(root, Number(state?.number), failed.map((check) => ({ name: check.name, workflow: String(check.workflow ?? ''), bucket: 'fail', link: String(check.link ?? ''), runId: String(check.runId ?? '') })))
  })
  ipcMain.handle(PR_WATCH_IPC.merge, async (event, request: { folder?: unknown; number?: unknown; headSha?: unknown; command?: unknown }): Promise<PrMergeResult> => {
    if (!fromAppWindow(getWindow(), event)) return { ok: false, error: NOT_PROJECT }
    const root = await known(request?.folder)
    if (!root) return { ok: false, error: NOT_PROJECT }
    return mergeWatched(root, { number: Number(request.number), headSha: String(request.headSha ?? ''), command: String(request.command ?? '') })
  })
  ipcMain.handle(PR_WATCH_IPC.tidy, async (event, request: PrTidyRequest): Promise<PrTidyResult> => {
    if (!fromAppWindow(getWindow(), event)) return { ok: false, error: NOT_PROJECT }
    const repo = await known(request?.repo)
    if (!repo) return { ok: false, error: NOT_PROJECT }
    return removeWorktreeSafely({ repo, path: String(request.path ?? ''), branch: String(request.branch ?? ''), headSha: String(request.headSha ?? ''), strict: request.strict !== false, dryRun: request.dryRun === true })
  })
  return () => watcher.stop()
}
