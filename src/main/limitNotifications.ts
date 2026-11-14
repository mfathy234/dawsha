import type { BrowserWindow } from 'electron'
import { AGENT_NAMES } from '../shared/agents'
import { detectLimitWarnings, desktopWarningText, limitReadings } from '../shared/limitWarnings'
import { createCodexLimitsReader } from './codexLimits'
import { notifyUser } from './desktop'
import type { SettingsStore } from './settingsStore'
import type { UsageService } from './usage'
import type { StatusWatcher } from './statusWatcher'

/** Main owns the monitor so background windows and renderer timer throttling cannot delay warnings. */
export function installLimitNotifications(getWindow: () => BrowserWindow | null, settings: SettingsStore, usage: UsageService, status: StatusWatcher): () => void {
  const readCodex = createCodexLimitsReader()
  let stopped = false
  let checking = false
  const tick = async (): Promise<void> => {
    if (stopped || checking) return
    checking = true
    try {
      const [codexResult, infos] = await Promise.all([readCodex(), status.current()])
      const codex = codexResult.entry
      if (stopped) return
      const current = settings.get()
      if (!current.warnUsageLimits || !current.sessionInfo.notifications) return
      // History is sampled for charts. The live source also sees reset-only changes and fresh unchanged percentages.
      const latest = infos.filter(info => info.rateLimits.length > 0).sort((a, b) => b.receivedAt - a.receivedAt)[0]
      const saved = usage.lastClaudeLimits()
      const claude = latest && (!saved || latest.receivedAt >= saved.at) ? { windows: latest.rateLimits, at: latest.receivedAt } : saved
      const readings = limitReadings({ ...(claude ? { claude } : {}), ...(codex ? { codex } : {}) }, Date.now())
      const result = detectLimitWarnings(current.warnedUsageWindows, readings)
      if (result.warned === current.warnedUsageWindows) return
      // Persist before delivery so a quick quit cannot repeat the same threshold next launch.
      settings.update({ warnedUsageWindows: result.warned })
      for (const { agent, window } of result.fire) {
        notifyUser(getWindow, { paneId: '', title: 'Dawsha', body: desktopWarningText(AGENT_NAMES[agent], window), sound: current.sessionInfo.sound }, () => undefined)
      }
    } catch (error) { console.warn('Could not check usage limit warnings', error) }
    finally { checking = false }
  }
  void tick()
  const timer = setInterval(() => { void tick() }, 5000)
  return () => { stopped = true; clearInterval(timer) }
}
