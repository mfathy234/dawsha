import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseNotificationActivation } from '../../src/shared/notificationAction'

const spawn = vi.hoisted(() => vi.fn((_file: string, _args: unknown, _options?: unknown) => ({ on: vi.fn(), unref: vi.fn() })))
vi.mock('node:child_process', () => ({ spawn }))
const notifications = vi.hoisted(() => [] as Array<{ handlers: Record<string, () => void>; show: () => void }>)
vi.mock('electron', () => {
  class Notification {
    static isSupported = (): boolean => true
    handlers: Record<string, () => void> = {}
    constructor() { notifications.push(this) }
    on(event: string, handler: () => void): this { this.handlers[event] = handler; return this }
    show(): void {}
  }
  return { BrowserWindow: vi.fn(), Notification, shell: { openPath: vi.fn() }, app: { setBadgeCount: vi.fn() }, nativeImage: { createFromBitmap: vi.fn() } }
})
vi.mock('../../src/main/executables', () => ({
  resolveExecutable: () => '/usr/bin/code', platformExecutableDirs: () => ['/usr/bin']
}))

import { applyAttentionBadge, handleNotificationActivation, liveNotificationCount, notifyUser, onAttentionCount, quickOpen } from '../../src/main/desktop'

it('publishes count changes and flashes once for each newly waiting session', () => {
  applyAttentionBadge(null, 0, [])
  const counts: number[] = []
  const unsubscribe = onAttentionCount(count => counts.push(count))
  const window = { isDestroyed: () => false, isFocused: () => false, flashFrame: vi.fn(), setTitle: vi.fn(), setOverlayIcon: vi.fn() }
  applyAttentionBadge(window as never, 1, ['a'])
  applyAttentionBadge(window as never, 1, ['a'])
  applyAttentionBadge(window as never, 1, ['b'])
  expect(window.flashFrame.mock.calls).toEqual([[true], [true]])
  expect(counts).toEqual([0, 1])
  unsubscribe()
  applyAttentionBadge(null, 0, [])
  expect(counts).toEqual([0, 1])
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

it('passes Linux folder names literally to VS Code without shell evaluation', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  vi.stubEnv('DAWSHA_OPEN_LOG', '')
  const folder = '/tmp/project$(touch injected) `echo bad` "quoted"'
  await quickOpen('vscode', folder)
  expect(spawn).toHaveBeenCalledWith('/usr/bin/code', ['--reuse-window', folder], expect.objectContaining({
    detached: true, stdio: 'ignore'
  }))
  expect(spawn.mock.calls[0][2]).not.toHaveProperty('shell', true)
})

it('keeps a notification alive until it is clicked, then raises the window and routes to its pane', () => {
  vi.stubEnv('DAWSHA_NOTIFY_LOG', '')
  const window = { isDestroyed: () => false, isFocused: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn(), flashFrame: vi.fn() }
  const onClick = vi.fn()
  const before = liveNotificationCount()
  notifyUser(() => window as never, { paneId: 'pane-7', title: 'Done', body: 'Finished', sound: false }, onClick)
  expect(liveNotificationCount()).toBe(before + 1)
  notifications.at(-1)!.handlers.click()
  expect(window.restore).toHaveBeenCalled()
  expect(window.focus).toHaveBeenCalled()
  expect(onClick).toHaveBeenCalledWith('pane-7')
  expect(liveNotificationCount()).toBe(before)
})

it('releases notifications that close or fail, and caps how many it keeps', () => {
  vi.stubEnv('DAWSHA_NOTIFY_LOG', '')
  const window = { isDestroyed: () => false, isFocused: () => true, flashFrame: vi.fn() }
  const before = liveNotificationCount()
  notifyUser(() => window as never, { paneId: 'a', title: 't', body: 'b', sound: false }, vi.fn())
  notifications.at(-1)!.handlers.close()
  notifyUser(() => window as never, { paneId: 'b', title: 't', body: 'b', sound: false }, vi.fn())
  notifications.at(-1)!.handlers.failed()
  expect(liveNotificationCount()).toBe(before)
  for (let index = 0; index < 30; index++) notifyUser(() => window as never, { paneId: `p${index}`, title: 't', body: 'b', sound: false }, vi.fn())
  expect(liveNotificationCount()).toBe(20)
})

it('logs Windows permission actions without private prompts and authorizes them once through main', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const file = join(mkdtempSync(join(tmpdir(), 'dawsha-notify-test-')), 'notify.log')
  vi.stubEnv('DAWSHA_NOTIFY_LOG', file)
  const permission = { tabId: 'tab', promptId: 'instance:1' }
  notifyUser(() => null, { paneId: 'pane', title: 'Review', body: 'Wants to run npm --token="private-value"', sound: false, permission }, vi.fn())
  const raw = readFileSync(file, 'utf8')
  expect(raw).not.toContain('private-value')
  expect(raw).not.toContain('promptId')
  const note = JSON.parse(raw)
  expect(note.actions.map((action: { content: string }) => action.content)).toEqual(['Allow', 'Deny'])
  expect(parseNotificationActivation(note.actions[0].arguments)).toMatchObject({ paneId: 'pane', allow: true })
  const onClick = vi.fn()
  expect(handleNotificationActivation(['Dawsha.exe', note.actions[0].arguments], () => null, onClick)).toBe(true)
  expect(onClick).toHaveBeenLastCalledWith('pane', { ...permission, allow: true })
  handleNotificationActivation([note.actions[1].arguments], () => null, onClick)
  expect(onClick).toHaveBeenLastCalledWith('pane', undefined)
  handleNotificationActivation(['dawsha-action:allow?pane=pane&request=' + 'b'.repeat(32)], () => null, onClick)
  expect(onClick).toHaveBeenLastCalledWith('pane', undefined)
  expect(handleNotificationActivation(['--new-session'], () => null, onClick)).toBe(false)
})

it.each(['linux', 'darwin'] as const)('keeps %s notifications plain', platform => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  const file = join(mkdtempSync(join(tmpdir(), 'dawsha-notify-test-')), 'notify.log')
  vi.stubEnv('DAWSHA_NOTIFY_LOG', file)
  notifyUser(() => null, { paneId: 'pane', title: 'Review', body: 'Waiting', sound: false, permission: { tabId: 't', promptId: 'instance:1' } }, vi.fn())
  expect(JSON.parse(readFileSync(file, 'utf8'))).not.toHaveProperty('actions')
})
