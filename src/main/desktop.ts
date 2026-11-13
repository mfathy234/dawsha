import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readdirSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { BrowserWindow, Notification, app, nativeImage, shell } from 'electron'
import { OVERLAY_SIZE, badgeWindowTitle, normalizeBadgeCount, overlayBitmap } from '../shared/attentionBadge'
import { newlyWaiting } from '../shared/waitingAttention'
import { safeLink } from '../shared/markdown'
import { toastXml } from '../shared/notifyContent'
import { maskSecrets } from '../shared/maskSecrets'
import { notificationActions, parseNotificationActivation, NOTIFICATION_SCHEME, type NotificationAction, type NotificationAnswer } from '../shared/notificationAction'
import { NotificationRequests } from './notificationRequests'
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

// Shows a project file or folder selected in the system file manager. The path is already checked to be inside a project.
export function revealInFolder(full: string): void {
  const log = process.env.DAWSHA_OPEN_LOG
  if (log) return logTo(log, JSON.stringify({ kind: 'reveal', path: full }))
  shell.showItemInFolder(full)
}

// One file in the running VS Code window, at a line when given. The path is already checked to be a project file.
export async function openInVsCode(full: string, line?: number): Promise<void> {
  const log = process.env.DAWSHA_OPEN_LOG
  if (log) return logTo(log, JSON.stringify({ kind: 'vscode-file', path: full, ...(line ? { line } : {}) }))
  const target = line ? `${full}:${line}` : full
  const executable = resolveExecutable('code', platformExecutableDirs())
  const args = ['--reuse-window', '-g', target]
  // On Windows `code` is a .cmd, which needs a shell that expands %VAR% in the path; Code.exe next to it takes the arguments directly.
  const exe = process.platform === 'win32' && executable ? join(dirname(executable), '..', 'Code.exe') : null
  const child = process.platform !== 'win32'
    ? spawn(executable ?? 'code', args, { detached: true, stdio: 'ignore' })
    : exe && existsSync(exe)
      ? spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true })
      : target.includes('%')
        ? null
        : spawn(`code --reuse-window -g "${target}"`, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
  child?.on('error', () => undefined)
  child?.unref()
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

const MAX_NOTIFY_TEXT = 300

const notifyString = (value: unknown): string => (typeof value === 'string' ? value.slice(0, MAX_NOTIFY_TEXT) : '')

/** The renderer's request, reduced to known string fields of a sane length. */
function cleanRequest(raw: NotifyRequest): NotifyRequest {
  const attribution = maskSecrets(notifyString(raw?.attribution))
  const permission = raw?.permission
  const validPermission = permission && typeof permission.tabId === 'string' && permission.tabId.length > 0 && permission.tabId.length <= 200
    && typeof permission.promptId === 'string' && /^[a-z0-9-]+:\d+$/i.test(permission.promptId) && permission.promptId.length <= 100
  return { paneId: notifyString(raw?.paneId), title: maskSecrets(notifyString(raw?.title)), body: maskSecrets(notifyString(raw?.body)), sound: raw?.sound === true, ...(raw?.flash === false ? { flash: false } : {}), ...(attribution ? { attribution } : {}), ...(validPermission ? { permission: { tabId: permission.tabId, promptId: permission.promptId } } : {}) }
}

function createNotification(request: NotifyRequest, actions: NotificationAction[]): Notification {
  if (process.platform !== 'win32') {
    const body = request.attribution ? `${request.body}\n${request.attribution}` : request.body
    return new Notification({ title: request.title, body, silent: !request.sound })
  }
  return new Notification({ toastXml: toastXml({ title: request.title, body: request.body, attribution: request.attribution, silent: !request.sound, actions }) })
}

const notificationRequests = new NotificationRequests()

/** Protocol activations work for both installed NSIS and default Electron launches. Unknown tokens only open the pane. */
export function handleNotificationActivation(argv: string[], getWindow: () => BrowserWindow | null, onClick: (paneId: string, answer?: NotificationAnswer) => void): boolean {
  const argument = argv.find(value => value.startsWith(`${NOTIFICATION_SCHEME}:`))
  if (!argument) return false
  const activation = parseNotificationActivation(argument)
  if (!activation) return true
  const answer = notificationRequests.take(activation)
  const window = getWindow()
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  onClick(activation.paneId, answer)
  return true
}

export function notifyUser(getWindow: () => BrowserWindow | null, raw: NotifyRequest, onClick: (paneId: string) => void): void {
  const request = cleanRequest(raw)
  const window = getWindow()
  const unfocused = !window || window.isDestroyed() || !window.isFocused()
  const { permission, ...publicRequest } = request
  const requestId = process.platform === 'win32' && permission ? randomBytes(16).toString('hex') : null
  const actions = requestId ? notificationActions(request.paneId, requestId) : []
  if (requestId && permission) notificationRequests.add(request.paneId, requestId, permission)
  const log = process.env.DAWSHA_NOTIFY_LOG
  if (log) return logTo(log, JSON.stringify({ ...publicRequest, flash: unfocused && request.flash !== false, ...(actions.length ? { actions } : {}) }))
  if (window && !window.isDestroyed() && unfocused && request.flash !== false) window.flashFrame(true)
  if (!Notification.isSupported()) return
  const notification = createNotification(request, actions)
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

let attentionCount = 0
let waitingSessions: string[] = []
const attentionListeners = new Set<(count: number) => void>()

/** Immediately reports the current count; returns an unsubscribe function for tray teardown. */
export function onAttentionCount(listener: (count: number) => void): () => void {
  attentionListeners.add(listener)
  listener(attentionCount)
  return () => { attentionListeners.delete(listener) }
}

export function applyAttentionBadge(window: BrowserWindow | null, value: unknown, rawIds?: unknown): void {
  const count = normalizeBadgeCount(value)
  const ids = Array.isArray(rawIds) ? [...new Set(rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length < 200))].slice(0, 500) : []
  const fresh = newlyWaiting(waitingSessions, ids)
  waitingSessions = ids
  if (count !== attentionCount) {
    attentionCount = count
    for (const listener of attentionListeners) {
      try { listener(count) } catch { /* A consumer cannot prevent the taskbar update. */ }
    }
  }
  if (fresh.length && window && !window.isDestroyed() && !window.isFocused()) window.flashFrame(true)
  if (process.platform !== 'win32') app.setBadgeCount(count)
  if (!window || window.isDestroyed()) return
  window.setTitle(badgeWindowTitle(count))
  if (process.platform !== 'win32') return
  const image = count > 0 ? nativeImage.createFromBitmap(overlayBitmap(count), { width: OVERLAY_SIZE, height: OVERLAY_SIZE }) : null
  window.setOverlayIcon(image, count > 0 ? `${count} waiting for you` : '')
}
