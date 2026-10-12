import { autoUpdater } from 'electron-updater'
import type { BackendEvent, UpdaterBackend } from './updateController'

export function createGithubBackend(): UpdaterBackend {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.logger = null
  autoUpdater.on('update-downloaded', () => {
    autoUpdater.autoInstallOnAppQuit = true
  })
  return {
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    quitAndInstall: (silent, forceRunAfter) => autoUpdater.quitAndInstall(silent, forceRunAfter),
    on: (event: BackendEvent, listener) => {
      autoUpdater.on(event as 'error', listener as (error: Error) => void)
    }
  }
}
