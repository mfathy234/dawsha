import { ipcRenderer } from 'electron'
import { TOOLS_IPC, type FilesToolsApi } from '../shared/filesTools'
import type { BrowserState } from '../shared/browserPane'

export function createFilesToolsPreload(): FilesToolsApi {
  return {
    readConfig: (folder) => ipcRenderer.invoke(TOOLS_IPC.configRead, folder),
    revealConfig: (request) => ipcRenderer.invoke(TOOLS_IPC.configReveal, request),
    pullRequest: ((request: unknown) => ipcRenderer.invoke(TOOLS_IPC.pr, request)) as FilesToolsApi['pullRequest'],
    browser: (command) => ipcRenderer.invoke(TOOLS_IPC.browser, command),
    browserShot: () => ipcRenderer.invoke(TOOLS_IPC.browserShot),
    browserErrors: () => ipcRenderer.invoke(TOOLS_IPC.browserErrors),
    onBrowserState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: BrowserState): void => listener(state)
      ipcRenderer.on(TOOLS_IPC.browserState, handler)
      return () => ipcRenderer.removeListener(TOOLS_IPC.browserState, handler)
    }
  }
}
