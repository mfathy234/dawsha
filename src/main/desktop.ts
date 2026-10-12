import { spawn } from 'node:child_process'
import { appendFileSync, readdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { BrowserWindow, Notification, shell } from 'electron'
import { safeLink } from '../shared/markdown'
import { platformExecutableDirs, resolveExecutable } from './executables'
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
  const child = process.platform === 'darwin'
    ? spawn(resolveExecutable('code', platformExecutableDirs()) ?? 'code', ['--reuse-window', folder], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, PATH: [...new Set([...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...platformExecutableDirs()])].join(delimiter) }
      })
    : spawn(`code "${folder}"`, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
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

export function notifyUser(getWindow: () => BrowserWindow | null, request: NotifyRequest, onClick: (paneId: string) => void): void {
  const window = getWindow()
  const unfocused = !window || window.isDestroyed() || !window.isFocused()
  const log = process.env.DAWSHA_NOTIFY_LOG
  if (log) return logTo(log, JSON.stringify({ ...request, flash: unfocused }))
  if (window && !window.isDestroyed() && unfocused) window.flashFrame(true)
  if (!Notification.isSupported()) return
  const notification = new Notification({ title: request.title, body: request.body, silent: !request.sound })
  notification.on('click', () => {
    const activeWindow = getWindow()
    if (!activeWindow || activeWindow.isDestroyed()) return
    if (activeWindow.isMinimized()) activeWindow.restore()
    activeWindow.show()
    activeWindow.focus()
    onClick(request.paneId)
  })
  notification.show()
}
