import { ipcRenderer } from 'electron'
import { PR_WATCH_IPC, type PrWatchApi, type PrWatchUpdate } from '../shared/prWatch'

export function createPrWatchPreload(): PrWatchApi {
  return {
    sync: (targets) => ipcRenderer.send(PR_WATCH_IPC.sync, targets),
    refresh: (key) => ipcRenderer.send(PR_WATCH_IPC.refresh, key),
    fixCi: (folder, state) => ipcRenderer.invoke(PR_WATCH_IPC.fixCi, folder, state),
    merge: (request) => ipcRenderer.invoke(PR_WATCH_IPC.merge, request),
    tidy: (request) => ipcRenderer.invoke(PR_WATCH_IPC.tidy, request),
    onUpdate: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, update: PrWatchUpdate): void => listener(update)
      ipcRenderer.on(PR_WATCH_IPC.update, handler)
      return () => ipcRenderer.removeListener(PR_WATCH_IPC.update, handler)
    }
  }
}
