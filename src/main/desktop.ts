import { spawn } from 'node:child_process'
import { appendFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, Notification, shell } from 'electron'
import { IPC } from '../shared/ipc'
import { safeLink } from '../shared/markdown'
import type { NotifyRequest, QuickOpenKind } from '../shared/types'

export function logTo(file: string, line: string): void {
  try {
    appendFileSync(file, `${line}\n`, 'utf8')
  } catch {
    return
  }
}

export function findSolution(folder: string): string | null {
  try {
    return readdirSync(folder).find((name) => /\.(sln|slnx)$/i.test(name)) ?? null
  } catch {
    return null
  }
}

export async function quickOpen(kind: QuickOpenKind, folder: string): Promise<void> {
  const log = process.env.DAWSHA_OPEN_LOG
  if (log) return logTo(log, JSON.stringify({ kind, folder }))
  if (kind === 'explorer') {
    await shell.openPath(folder)
    return
  }
  if (kind === 'visualstudio') {
    const solution = findSolution(folder)
    if (solution) await shell.openPath(join(folder, solution))
    return
  }
  const child = spawn(`code "${folder}"`, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => undefined)
  child.unref()
}

export async function openLink(url: string): Promise<void> {
  const href = safeLink(url)
  if (!href) return
  const log = process.env.DAWSHA_OPEN_LOG
  if (log) return logTo(log, JSON.stringify({ link: href }))
  await shell.openExternal(href)
}

export function notifyUser(window: BrowserWindow | null, request: NotifyRequest): void {
  const unfocused = !window || window.isDestroyed() || !window.isFocused()
  const log = process.env.DAWSHA_NOTIFY_LOG
  if (log) return logTo(log, JSON.stringify({ ...request, flash: unfocused }))
  if (window && !window.isDestroyed() && unfocused) window.flashFrame(true)
  if (!Notification.isSupported()) return
  const notification = new Notification({ title: request.title, body: request.body, silent: !request.sound })
  notification.on('click', () => {
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    window.webContents.send(IPC.notifyClick, request.paneId)
  })
  notification.show()
}
