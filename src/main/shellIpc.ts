import { app, ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import { oscProgress, type TerminalProgress } from '../shared/terminalOsc'
import { validHistoryCommand } from '../shared/shellCommands'
import type { SettingsStore } from './settingsStore'
import { ShellHistory } from './shellHistory'

export function registerShellIpc(getWindow: () => BrowserWindow | null, settings: SettingsStore): void {
  const history = new ShellHistory(app.getPath('userData'))
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => {
    const window = getWindow()
    return !!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
  }
  const knownProject = (id: unknown): id is string => typeof id === 'string' && settings.get().projects.some((p) => p.id === id)
  ipcMain.handle(IPC.shellHistoryGet, (event, projectId: unknown) => trusted(event) && knownProject(projectId) ? history.list(projectId) : [])
  ipcMain.handle(IPC.shellHistoryAdd, (event, projectId: unknown, command: unknown, cwd: unknown) => {
    if (!trusted(event) || !knownProject(projectId) || !validHistoryCommand(command) || typeof cwd !== 'string' || cwd.length > 8000) return
    history.add(projectId, command, cwd)
  })
  ipcMain.on(IPC.terminalProgress, (event, progress: TerminalProgress | null) => {
    if (!trusted(event)) return
    const value = progress && oscProgress(`4;${progress.state};${progress.percent}`)
    const window = getWindow()
    if (!window) return
    if (!value || value.state === 0) { window.setProgressBar(-1); return }
    const modes = { 1: 'normal', 2: 'error', 3: 'indeterminate', 4: 'paused' } as const
    window.setProgressBar(value.state === 3 ? 2 : value.percent / 100, { mode: modes[value.state] })
  })
}
