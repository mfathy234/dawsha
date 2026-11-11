import { realpath } from 'node:fs/promises'
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { RunCommand } from '../shared/runCommands'
import { sanitizeRunOverrides } from '../shared/runCommands'
import { MAX_CHECKS } from '../shared/turnChecks'
import { TURN_IPC, type RunChecksRequest, type RunChecksResult, type TurnFileDiffRequest, type TurnFileDiffResult, type TurnFileInfo } from '../shared/turnApi'
import { knownProjectFolder } from './knownFolder'
import { discoverRunCommands } from './runCommands/discovery'
import { runPath } from './runCommands/paths'
import { TurnChecksRunner } from './turnChecksRunner'
import { inspectFiles, turnFileDiff } from './turnFiles'

interface TurnStore {
  get(): { projects: ReadonlyArray<{ id: string; folder: string }>; runCommands?: unknown }
}

const SESSION = /^[a-zA-Z0-9_-]{1,128}$/
const NOT_PROJECT = 'This folder is not one of your projects.'

const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0')

function fromAppWindow(window: BrowserWindow | null, event: IpcMainInvokeEvent): boolean {
  return !!window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
}

/** The chosen commands as they run today: detected ones, with the project's local commands taking over their ids. */
async function resolveCommands(store: TurnStore, folder: string, projectId: string, ids: readonly string[]): Promise<Array<{ command: RunCommand; cwd: string }>> {
  const base = await realpath(folder)
  const local = sanitizeRunOverrides(store.get().runCommands).find((entry) => entry.projectId === projectId && entry.folder === base)?.commands ?? []
  const detected = (await discoverRunCommands(base)).commands
  const all = new Map<string, RunCommand>(detected.map((command) => [command.id, command]))
  for (const item of local) all.set(item.id, { ...item, source: 'Local override', display: item.shellCommand })
  const planned: Array<{ command: RunCommand; cwd: string }> = []
  for (const id of ids) {
    const command = all.get(id)
    if (!command) continue
    try {
      planned.push({ command, cwd: await runPath(base, command.cwd, true) })
    } catch {
      // A working folder that is gone or unsafe is skipped; the rest still run.
    }
  }
  return planned
}

/** Diffs against a reply's checkpoint and the checks that run after a reply. Returns a function that stops running checks. */
export function registerTurnIpc(getWindow: () => BrowserWindow | null, store: TurnStore): () => Promise<void> {
  const runner = new TurnChecksRunner(
    (update) => {
      const window = getWindow()
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(TURN_IPC.checksUpdate, update)
    },
    { resolve: (folder, projectId, ids) => resolveCommands(store, folder, projectId, ids) }
  )
  const known = (folder: unknown): Promise<string | null> => knownProjectFolder(store.get().projects, folder)
  const guarded = <A extends unknown[], R>(refusal: R, run: (...args: A) => R | Promise<R>) => (event: IpcMainInvokeEvent, ...args: A): R | Promise<R> =>
    fromAppWindow(getWindow(), event) ? run(...args) : refusal

  ipcMain.handle(TURN_IPC.fileDiff, guarded<[TurnFileDiffRequest], TurnFileDiffResult>({ ok: false, error: NOT_PROJECT }, async (request) => {
    const root = await known(request?.folder)
    return root ? turnFileDiff(root, request.sessionId, request.ref, request.path) : { ok: false, error: NOT_PROJECT }
  }))
  ipcMain.handle(TURN_IPC.inspect, guarded<[unknown, unknown], Record<string, TurnFileInfo>>({}, async (folder, paths) => {
    const root = await known(folder)
    return root ? inspectFiles(root, paths) : {}
  }))
  ipcMain.handle(TURN_IPC.runChecks, guarded<[RunChecksRequest], RunChecksResult>({ ok: false, error: NOT_PROJECT }, async (request) => {
    const ids = Array.isArray(request?.commandIds) ? request.commandIds : []
    if (!text(request?.projectId, 200) || !SESSION.test(String(request?.sessionId)) || ids.length === 0 || ids.length > MAX_CHECKS || !ids.every((id) => text(id, 512))) return { ok: false, error: 'Those checks are not valid.' }
    if (!store.get().projects.some((project) => project.id === request.projectId)) return { ok: false, error: NOT_PROJECT }
    const root = await known(request.folder)
    if (!root) return { ok: false, error: NOT_PROJECT }
    try {
      return { ok: true, runId: await runner.start(root, request.projectId, request.sessionId, ids) }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }))
  ipcMain.handle(TURN_IPC.stopChecks, guarded<[unknown], void>(undefined, async (sessionId) => {
    if (typeof sessionId === 'string' && SESSION.test(sessionId)) await runner.stop(sessionId)
  }))
  return () => runner.dispose()
}
