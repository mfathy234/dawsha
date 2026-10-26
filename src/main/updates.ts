import { app, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import { detectUpdateMode } from '../shared/updates'
import { appVersion } from './appVersion'
import { openLink } from './desktop'
import { createFakeBackend } from './fakeUpdater'
import type { SettingsStore } from './settingsStore'
import { DEFAULT_INTERVAL_MS, DEFAULT_START_DELAY_MS, UpdateController, type UpdaterBackend } from './updateController'
import { createGithubBackend } from './updaterBackend'

export interface UpdatesOptions {
  settings: SettingsStore
  send: (channel: string, ...args: unknown[]) => void
  shutdown: () => Promise<void>
  markQuitting: () => void
  /** Asked before an update restart shuts the app down; false keeps the app running. */
  mayQuit?: () => Promise<boolean>
  autoUpdates?: boolean
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function setupUpdates(options: UpdatesOptions): UpdateController {
  const fake = process.env.DAWSHA_TEST_UPDATER === 'fake'
  const mode = options.autoUpdates === false
    ? 'dev'
    : detectUpdateMode({ packaged: app.isPackaged, portableDir: process.env.PORTABLE_EXECUTABLE_DIR, fake })
  const backend = mode === 'dev' ? createInertBackend() : fake ? createFakeBackend() : createGithubBackend()
  const controller = new UpdateController({
    backend,
    mode,
    currentVersion: appVersion(),
    autoCheck: () => options.settings.get().autoUpdateCheck,
    onChange: (state) => options.send(IPC.updateState, state),
    startDelayMs: numberFromEnv('DAWSHA_UPDATE_START_DELAY_MS', DEFAULT_START_DELAY_MS),
    intervalMs: numberFromEnv('DAWSHA_UPDATE_INTERVAL_MS', DEFAULT_INTERVAL_MS)
  })
  ipcMain.handle(IPC.updateGet, () => controller.state)
  ipcMain.handle(IPC.updateCheck, () => controller.check(true))
  ipcMain.handle(IPC.updateDownload, () => controller.download())
  ipcMain.handle(IPC.updateRetry, () => controller.retry())
  ipcMain.handle(IPC.updateDismiss, () => controller.dismiss())
  ipcMain.handle(IPC.updateOpenLink, (_event, url: unknown) => openLink(typeof url === 'string' ? url : ''))
  ipcMain.handle(IPC.updateRestart, async () => {
    if (controller.state.status !== 'ready' || controller.state.mode !== 'installed') return
    if (options.mayQuit && !(await options.mayQuit())) return
    await options.shutdown()
    options.markQuitting()
    controller.restart()
  })
  controller.start()
  return controller
}

function createInertBackend(): UpdaterBackend {
  return {
    checkForUpdates: async () => undefined,
    downloadUpdate: async () => undefined,
    quitAndInstall: () => undefined,
    on: () => undefined
  }
}
