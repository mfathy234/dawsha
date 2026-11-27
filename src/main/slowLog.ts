import { join } from 'node:path'
import { ipcMain, app } from 'electron'
import { IPC } from '../shared/ipc'
import type { SlowReport } from '../shared/slowLog'
import { slowLogGate, writeSlowLine } from './slowLogFile'

const SLOW_MS = 500
const CHECK_MS = 100

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
  const onPage = (_event: unknown, report: SlowReport): void => {
    if (!allowed(Date.now())) return
    writeSlowLine(path, `page task ${Math.round(report.ms)} ms; view: ${String(report.view).slice(0, 40)}; ${String(report.detail).slice(0, 200)}`)
  }
  ipcMain.on(IPC.slowReport, onPage)
  return () => {
    ipcMain.handle = originalHandle as typeof ipcMain.handle
    clearInterval(timer)
    ipcMain.removeListener(IPC.slowReport, onPage)
  }
}
