import type { BrowserWindow } from 'electron'
import { AGENT_NAMES } from '../shared/agents'
import { detectLimitWarnings, desktopWarningText, limitReadings, sanitizeWarnedWindows, warningDetail, warningTitle } from '../shared/limitWarnings'
import { IPC } from '../shared/ipc'
import { createCodexLimitsReader } from './codexLimits'
import { notifyUser } from './desktop'
import type { SettingsStore } from './settingsStore'
import type { UsageService } from './usage'
import type { StatusWatcher } from './statusWatcher'

const LEGACY_WAIT_MS = 10_000
let legacyDone: () => void = () => undefined
const legacySettled = new Promise<void>((resolve) => { legacyDone = resolve })

/**
 * Before 1.8.9 the page remembered warned windows in localStorage. The page hands that over once, so an upgrade does not
 * repeat a warning it already showed. Entries main already knows win.
 */
export function migrateLegacyLimitWarnings(settings: SettingsStore, legacy: unknown): void {
  try {
    const old = sanitizeWarnedWindows(legacy)
    if (Object.keys(old).length > 0) {
      const current = settings.get().warnedUsageWindows
      const merged = { ...old, ...current }
      if (Object.keys(merged).length !== Object.keys(current).length) settings.update({ warnedUsageWindows: merged })
    }
  } catch (error) { console.warn('Could not migrate the old usage warnings', error) }
  legacyDone()
}

function toastWarning(window: BrowserWindow | null, message: string): void {
  if (!window || window.isDestroyed()) return
  const send = (): void => { if (!window.isDestroyed()) window.webContents.send(IPC.limitWarning, message) }
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', send)
  else send()
}

/** Main owns the monitor so background windows and renderer timer throttling cannot delay warnings. */
export function installLimitNotifications(getWindow: () => BrowserWindow | null, settings: SettingsStore, usage: UsageService, status: StatusWatcher): () => void {
  const readCodex = createCodexLimitsReader()
  let stopped = false
  let checking = false
  const tick = async (): Promise<void> => {
    if (stopped || checking) return
    checking = true
    try {
      await Promise.race([legacySettled, new Promise((resolve) => setTimeout(resolve, LEGACY_WAIT_MS).unref())])
      const [codexResult, infos] = await Promise.all([readCodex(), status.current()])
      const codex = codexResult.entry
      if (stopped) return
      const current = settings.get()
      if (!current.warnUsageLimits) return
      // History is sampled for charts. The live source also sees reset-only changes and fresh unchanged percentages.
      const latest = infos.filter(info => info.rateLimits.length > 0).sort((a, b) => b.receivedAt - a.receivedAt)[0]
      const saved = usage.lastClaudeLimits()
      const claude = latest && (!saved || latest.receivedAt >= saved.at) ? { windows: latest.rateLimits, at: latest.receivedAt } : saved
      const readings = limitReadings({ ...(claude ? { claude } : {}), ...(codex ? { codex } : {}) }, Date.now())
      const result = detectLimitWarnings(current.warnedUsageWindows, readings)
      if (result.warned === current.warnedUsageWindows) return
      // Persist before delivery so a quick quit cannot repeat the same threshold next launch.
      settings.update({ warnedUsageWindows: result.warned })
      const target = getWindow()
      for (const { agent, window } of result.fire) {
        // Each warning goes one way: the in-app toast when notifications are off or the window is in front, otherwise the desktop.
        if (!current.sessionInfo.notifications || (target && !target.isDestroyed() && target.isFocused())) toastWarning(target, `${warningTitle(AGENT_NAMES[agent], window)}. ${warningDetail(window, Date.now())}`)
        else notifyUser(getWindow, { paneId: '', title: 'Dawsha', body: desktopWarningText(AGENT_NAMES[agent], window), sound: current.sessionInfo.sound }, () => undefined)
      }
    } catch (error) { console.warn('Could not check usage limit warnings', error) }
    finally { checking = false }
  }
  void tick()
  const timer = setInterval(() => { void tick() }, 5000)
  return () => { stopped = true; clearInterval(timer) }
}
