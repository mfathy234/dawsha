import { ipcRenderer } from 'electron'
import { RUN_IPC, type RunApi, type RunSnapshot } from '../shared/runCommands'

export function createRunPreload(): RunApi {
  return {
    discover: (request) => ipcRenderer.invoke(RUN_IPC.discover, request),
    chooseConfig: (target) => ipcRenderer.invoke(RUN_IPC.chooseConfig, target),
    save: (target, commands) =>
      ipcRenderer.invoke(RUN_IPC.save, target, commands),
    start: (request) => ipcRenderer.invoke(RUN_IPC.start, request),
    stop: (id) => ipcRenderer.invoke(RUN_IPC.stop, id),
    list: () => ipcRenderer.invoke(RUN_IPC.list),
    onChanged: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        runs: RunSnapshot[]
      ): void => listener(runs)
      ipcRenderer.on(RUN_IPC.changed, handler)
      return () => ipcRenderer.removeListener(RUN_IPC.changed, handler)
    }
  }
}
