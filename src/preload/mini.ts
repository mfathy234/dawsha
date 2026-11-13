import { contextBridge, ipcRenderer } from 'electron'
import type { MiniApi, MiniSnapshot } from '../shared/miniWindow'

// Keep this sandboxed preload self-contained: Electron cannot require Rollup shared chunks.
const MINI_IPC = { get: 'mini:get', snapshot: 'mini:snapshot', action: 'mini:action', resize: 'mini:resize' } as const

const api: MiniApi = {
  get: () => ipcRenderer.invoke(MINI_IPC.get),
  onSnapshot(listener) {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: MiniSnapshot): void => listener(snapshot)
    ipcRenderer.on(MINI_IPC.snapshot, handler)
    return () => ipcRenderer.removeListener(MINI_IPC.snapshot, handler)
  },
  action: action => ipcRenderer.send(MINI_IPC.action, action),
  resize: height => ipcRenderer.send(MINI_IPC.resize, height)
}
contextBridge.exposeInMainWorld('miniApi', api)
