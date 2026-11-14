import { app } from 'electron'
import { loginItemArgs, type DesktopSettings, type LoginItemState } from '../shared/desktopSettings'

const supported = (platform: string): boolean => app.isPackaged && (platform === 'win32' || platform === 'darwin')

export function readLoginItem(platform: string = process.platform): LoginItemState {
  if (!supported(platform)) return { platform, packaged: app.isPackaged, enabled: false }
  const native = app.getLoginItemSettings(platform === 'win32' ? { path: process.execPath } : {})
  const enabled = platform === 'win32'
    ? native.executableWillLaunchAtLogin === true
    : native.openAtLogin && native.status === 'enabled'
  return { platform, packaged: app.isPackaged, enabled }
}

export function setLoginItem(enabled: boolean, desktop: DesktopSettings, platform: string = process.platform): LoginItemState {
  if (!supported(platform)) return readLoginItem(platform)
  app.setLoginItemSettings({
    openAtLogin: enabled,
    ...(platform === 'win32' ? { enabled, path: process.execPath, args: loginItemArgs(platform, desktop) } : {})
  })
  return readLoginItem(platform)
}

/** Changing hidden startup must preserve the OS's actual enablement, including Task Manager overrides. */
export function reconcileLoginItem(before: DesktopSettings, after: DesktopSettings, platform: string = process.platform): void {
  if (!supported(platform) || platform !== 'win32') return
  if (JSON.stringify(loginItemArgs(platform, before)) === JSON.stringify(loginItemArgs(platform, after))) return
  if (readLoginItem(platform).enabled) setLoginItem(true, after, platform)
}
