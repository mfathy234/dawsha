import { powerMonitor, type BrowserWindow } from 'electron'
import { AWAY_IPC, initialAway, stepAway, type AwayFacts, type AwayMemory } from '../shared/away'

const POLL_MS = 5000

/** Tells the window when the owner leaves (window unfocused or hidden, screen locked, asleep, idle) and when they come back. Returns a function that stops it. */
export function installAwayWatcher(getWindow: () => BrowserWindow | null): () => void {
  let memory: AwayMemory = initialAway()
  let locked = false
  let suspended = false

  const facts = (): AwayFacts => {
    const window = getWindow()
    const alive = window !== null && !window.isDestroyed()
    return {
      windowFocused: alive && window.isFocused() && window.isVisible() && !window.isMinimized(),
      locked,
      suspended,
      idleSeconds: powerMonitor.getSystemIdleTime()
    }
  }

  const check = (): void => {
    const window = getWindow()
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
    const step = stepAway(memory, facts(), Date.now())
    memory = step.memory
    if (step.change) window.webContents.send(AWAY_IPC.changed, step.change)
  }

  powerMonitor.on('lock-screen', () => { locked = true; check() })
  powerMonitor.on('unlock-screen', () => { locked = false; check() })
  powerMonitor.on('suspend', () => { suspended = true; check() })
  powerMonitor.on('resume', () => { suspended = false; check() })
  const window = getWindow()
  window?.on('focus', check)
  window?.on('blur', check)
  window?.on('show', check)
  window?.on('hide', check)
  window?.on('minimize', check)
  window?.on('restore', check)
  const timer = setInterval(check, POLL_MS)
  return () => {
    clearInterval(timer)
    for (const event of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore'] as const) window?.removeListener(event as 'focus', check)
  }
}
