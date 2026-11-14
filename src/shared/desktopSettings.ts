export interface DesktopSettings {
  closeBehavior: 'quit' | 'tray'
  startHidden: boolean
}

export interface LoginItemState {
  platform: string
  packaged: boolean
  enabled: boolean
  /** False when the system tray could not be created, so keeping the window in it would strand the user. */
  trayAvailable?: boolean
}

export const DEFAULT_DESKTOP: DesktopSettings = { closeBehavior: 'quit', startHidden: false }

export function sanitizeDesktopSettings(value: unknown): DesktopSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { closeBehavior: raw.closeBehavior === 'tray' ? 'tray' : 'quit', startHidden: raw.startHidden === true }
}

/** A real Quit always wins over keeping the window in the tray, and without a tray the window can never be hidden. */
export function closeBehavior(preference: DesktopSettings['closeBehavior'], quitting: boolean, trayAvailable = true): 'hide' | 'quit' {
  return !quitting && trayAvailable && preference === 'tray' ? 'hide' : 'quit'
}

export function loginItemArgs(platform: string, settings: DesktopSettings): string[] {
  return platform === 'win32' && settings.closeBehavior === 'tray' && settings.startHidden ? ['--hidden'] : []
}

export function startHidden(argv: readonly string[], platform: string, settings: DesktopSettings, openedAtLogin: boolean): boolean {
  if (settings.closeBehavior !== 'tray') return false
  return argv.includes('--hidden') || (platform === 'darwin' && openedAtLogin && settings.startHidden)
}
