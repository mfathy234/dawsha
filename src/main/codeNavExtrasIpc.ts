import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import { codeNavigation } from './codeNav'
import { CodeNavExtras } from './codeNav/extras'
import { EditPreviews } from './codeNav/editPreviews'
import { staleCallers } from './codeNav/staleCallers'
import { replaceInFiles } from './replaceInFiles'
import { changeHunk } from './gitHunks'
import { agentFileActivity, setAgentEditSink } from './agentFiles'

export function registerCodeNavExtrasIpc(known: (folder: unknown) => Promise<string | null>, window: () => BrowserWindow | null): void {
  const previews = new EditPreviews()
  const extras = new CodeNavExtras(codeNavigation, previews)
  const actions: Record<string, (folder: string, request: unknown) => Promise<unknown>> = {
    [IPC.hover]: (folder, request) => extras.hover(folder, request),
    [IPC.renameSymbol]: (folder, request) => extras.renameSymbol(folder, request),
    [IPC.callHierarchy]: (folder, request) => extras.callHierarchy(folder, request),
    [IPC.staleCallers]: folder => staleCallers(folder, codeNavigation),
    [IPC.replaceInFiles]: (folder, request) => replaceInFiles(folder, request, previews),
    [IPC.stageChange]: (folder, request) => changeHunk(folder, request, 'stage'),
    [IPC.revertChange]: (folder, request) => changeHunk(folder, request, 'revert'),
    [IPC.lineSessions]: (folder, request) => agentFileActivity.lineSessions(folder, request)
  }
  for (const [channel, action] of Object.entries(actions)) {
    ipcMain.handle(channel, async (_event, folder: unknown, request: unknown) => {
      const root = await known(folder)
      if (!root) return { ok: false, error: 'Not a project folder.' }
      try { return await action(root, request) }
      catch { return { ok: false, error: 'Could not complete this Files request. Refresh and try again.' } }
    })
  }
  setAgentEditSink(event => {
    const target = window()
    if (target && !target.isDestroyed()) target.webContents.send(IPC.agentEdits, event)
  })
}
