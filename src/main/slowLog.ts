import { dirname, join } from 'node:path'
import { ipcMain, app, type IpcMainEvent, type WebContents } from 'electron'
import { IPC } from '../shared/ipc'
import type { ProfileSummary } from '../shared/profileSummary'
import type { SlowReport } from '../shared/slowLog'
import { PageSampler } from './pageSampler'
import { slowLogGate, slowPageLine, writeSlowLine, writeSlowProfile } from './slowLogFile'

const SLOW_MS = 500
const CHECK_MS = 100
const PROFILE_MS = 1000

export const slowLogPath = (): string => join(app.getPath('logs'), 'dawsha-slow.log')

/**
 * Writes one line to dawsha-slow.log, at most once every 10 seconds, whenever the main process or the page was stuck
 * for over half a second, with the last IPC channel main handled, so a freeze can be traced to its cause. Call it
 * before the IPC handlers are registered: it notes the channel of every handler added after it.
 */
export function installSlowLog(): () => void {
  const path = slowLogPath()
  let channel = 'none'
  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((name: string, listener: Parameters<typeof ipcMain.handle>[1]) =>
    originalHandle(name, (event, ...args) => { channel = name; return listener(event, ...args) })) as typeof ipcMain.handle
  const allowed = slowLogGate()
  let expected = Date.now() + CHECK_MS
  const timer = setInterval(() => {
    const now = Date.now()
    const late = now - expected
    expected = now + CHECK_MS
    if (late >= SLOW_MS && allowed(now)) writeSlowLine(path, `main blocked ${Math.round(late)} ms; last IPC: ${channel}`)
  }, CHECK_MS)
  timer.unref()
  const samplers = new Map<number, PageSampler>()
  const onCreated = (_event: unknown, contents: WebContents): void => {
    if (contents.getType() !== 'window') return
    const sampler = new PageSampler(contents)
    samplers.set(contents.id, sampler)
    contents.once('destroyed', () => { sampler.dispose(); samplers.delete(contents.id) })
    contents.once('did-finish-load', () => void sampler.start())
  }
  app.on('web-contents-created', onCreated)
  const write = (report: SlowReport, summary: ProfileSummary | null): void => {
    const withProfile = summary && summary.self.length > 0 ? { ...report, profile: summary } : report
    const file = withProfile.profile ? writeSlowProfile(dirname(path), { at: new Date().toISOString(), ms: report.ms, view: report.view, detail: report.detail, phases: report.phases, profile: withProfile.profile }) : null
    writeSlowLine(path, slowPageLine(withProfile, file))
  }
  const onPage = (event: IpcMainEvent, report: SlowReport): void => {
    if (!allowed(Date.now())) return
    const sampler = samplers.get(event.sender.id)
    if (report.ms < PROFILE_MS || !sampler) return write(report, null)
    void sampler.summarize(report.ms).then((summary) => write(report, summary), () => write(report, null))
  }
  ipcMain.on(IPC.slowReport, onPage)
  return () => {
    ipcMain.handle = originalHandle as typeof ipcMain.handle
    clearInterval(timer)
    ipcMain.removeListener(IPC.slowReport, onPage)
    app.removeListener('web-contents-created', onCreated)
    for (const sampler of samplers.values()) sampler.dispose()
  }
}
