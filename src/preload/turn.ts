import { ipcRenderer } from 'electron'
import { TURN_IPC, type TurnApi } from '../shared/turnApi'
import type { CheckRunUpdate } from '../shared/turnChecks'

export function createTurnPreload(): TurnApi {
  return {
    fileDiff: (request) => ipcRenderer.invoke(TURN_IPC.fileDiff, request),
    inspect: (folder, paths) => ipcRenderer.invoke(TURN_IPC.inspect, folder, paths),
    runChecks: (request) => ipcRenderer.invoke(TURN_IPC.runChecks, request),
    stopChecks: (sessionId) => ipcRenderer.invoke(TURN_IPC.stopChecks, sessionId),
    onChecksUpdate: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, update: CheckRunUpdate): void => listener(update)
      ipcRenderer.on(TURN_IPC.checksUpdate, handler)
      return () => ipcRenderer.removeListener(TURN_IPC.checksUpdate, handler)
    }
  }
}
