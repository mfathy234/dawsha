import { spawn } from 'node:child_process'
import { appendFileSync, readdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { BrowserWindow, Notification, app, nativeImage, shell } from 'electron'
import { OVERLAY_SIZE, badgeWindowTitle, normalizeBadgeCount, overlayBitmap } from '../shared/attentionBadge'
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
  const child = process.platform !== 'win32'
    ? spawn(resolveExecutable('code', platformExecutableDirs()) ?? 'code', ['--reuse-window', folder], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, PATH: [...new Set([...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...platformExecutableDirs()])].join(delimiter) }
      })
    : spawn(`code "${folder}"`, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => undefined)
  child.unref()
}

// One file in the running VS Code window, at a line when given. The path is already checked to be a project file.
export async function openInVsCode(full: string, line?: number): Promise<void> {
  const log = process.env.DAWSHA_OPEN_LOG
  if (log) return logTo(log, JSON.stringify({ kind: 'vscode-file', path: full, ...(line ? { line } : {}) }))
  const target = line ? `${full}:${line}` : full
  const child = process.platform !== 'win32'
    ? spawn(resolveExecutable('code', platformExecutableDirs()) ?? 'code', ['--reuse-window', '-g', target], { detached: true, stdio: 'ignore' })
    : spawn(`code --reuse-window -g "${target}"`, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
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

// Electron can garbage-collect a Notification nobody references, and its click handler goes with it:
// clicking the toast then neither raises Dawsha nor opens the session. Keep each one alive until it is
// clicked, closed or fails, and cap the set so old toasts cannot pile up.
const MAX_LIVE_NOTIFICATIONS = 20
const liveNotifications = new Set<Notification>()

export const liveNotificationCount = (): number => liveNotifications.size

function keepAlive(notification: Notification): void {
  liveNotifications.add(notification)
  if (liveNotifications.size > MAX_LIVE_NOTIFICATIONS) liveNotifications.delete(liveNotifications.values().next().value as Notification)
  const release = (): void => { liveNotifications.delete(notification) }
  notification.on('close', release)
  notification.on('failed', release)
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
    liveNotifications.delete(notification)
    const activeWindow = getWindow()
    if (!activeWindow || activeWindow.isDestroyed()) return
    if (activeWindow.isMinimized()) activeWindow.restore()
    activeWindow.show()
    activeWindow.focus()
    onClick(request.paneId)
  })
  keepAlive(notification)
  notification.show()
}

export function applyAttentionBadge(window: BrowserWindow | null, value: unknown): void {
  const count = normalizeBadgeCount(value)
  if (process.platform !== 'win32') app.setBadgeCount(count)
  if (!window || window.isDestroyed()) return
  window.setTitle(badgeWindowTitle(count))
  if (process.platform !== 'win32') return
  const image = count > 0 ? nativeImage.createFromBitmap(overlayBitmap(count), { width: OVERLAY_SIZE, height: OVERLAY_SIZE }) : null
  window.setOverlayIcon(image, count > 0 ? `${count} waiting for you` : '')
}
