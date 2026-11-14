export interface DesktopSettings {
  closeBehavior: 'quit' | 'tray'
  startHidden: boolean
}

export interface LoginItemState {
  platform: string
  packaged: boolean
  enabled: boolean
}

export const DEFAULT_DESKTOP: DesktopSettings = { closeBehavior: 'quit', startHidden: false }

export function sanitizeDesktopSettings(value: unknown): DesktopSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { closeBehavior: raw.closeBehavior === 'tray' ? 'tray' : 'quit', startHidden: raw.startHidden === true }
}

/** A real Quit always wins over keeping the window in the tray. */
export function closeBehavior(platform: string, preference: DesktopSettings['closeBehavior'], quitting: boolean): 'hide' | 'quit' {
  return !quitting && (platform === 'darwin' || preference === 'tray') ? 'hide' : 'quit'
}

export function loginItemArgs(platform: string, settings: DesktopSettings): string[] {
  return platform === 'win32' && settings.closeBehavior === 'tray' && settings.startHidden ? ['--hidden'] : []
}

export function startHidden(argv: readonly string[], platform: string, settings: DesktopSettings, openedAtLogin: boolean): boolean {
  if (platform !== 'darwin' && settings.closeBehavior !== 'tray') return false
  return argv.includes('--hidden') || (platform === 'darwin' && openedAtLogin && settings.startHidden)
}
