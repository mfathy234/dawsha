import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent
} from 'electron'
import { relative } from 'node:path'
import { RUN_IPC } from '../../shared/runCommands'
import { RunCommandService, type RunStore } from './service'
import { RunProcesses } from './processes'
import { runPath } from './paths'

export type { RunStore } from './service'
export function registerRunIpc(
  getWindow: () => BrowserWindow | null,
  store: RunStore
): () => Promise<void> {
  const runner = new RunProcesses((runs) => {
    const window = getWindow()
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send(RUN_IPC.changed, runs)
  })
  const service = new RunCommandService(store, runner)
  const handlers: string[] = []
  function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const window = getWindow()
      if (
        !window ||
        window.isDestroyed() ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error(
          'Run commands are only available in the application window.'
        )
      return fn(...args)
    })
    handlers.push(channel)
  }
  handle(RUN_IPC.discover, (request) => service.discover(request))
  handle(RUN_IPC.save, (target, commands) => service.save(target, commands))
  handle(RUN_IPC.start, (request) => service.start(request))
  handle(RUN_IPC.stop, (id) => service.stop(id))
  handle(RUN_IPC.list, () => service.list())
  handle(RUN_IPC.chooseConfig, async (request) => {
    const target = await service.target(request),
      window = getWindow()
    if (!window) return null
    const choice = await dialog.showOpenDialog(window, {
      title: 'Choose solution/project or package.json',
      defaultPath: target.folder,
      properties: ['openFile'],
      filters: [
        {
          name: 'Run configuration',
          extensions: ['sln', 'slnx', 'csproj', 'json']
        }
      ]
    })
    if (choice.canceled || !choice.filePaths[0]) return null
    const rel = relative(target.folder, choice.filePaths[0]).replace(/\\/g, '/')
    await runPath(target.folder, rel)
    if (!/(?:\.slnx?|\.csproj|(?:^|\/)package\.json)$/i.test(rel))
      throw new Error(
        'Choose a package.json, .csproj, .sln, or .slnx file inside this checkout.'
      )
    return rel
  })
  return async () => {
    for (const channel of handlers) ipcMain.removeHandler(channel)
    await service.dispose()
  }
}
