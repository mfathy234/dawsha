import { afterEach, expect, it, vi } from 'vitest'

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
  return { BrowserWindow: vi.fn(), Notification, shell: { openPath: vi.fn() } }
})
vi.mock('../../src/main/executables', () => ({
  resolveExecutable: () => '/usr/bin/code', platformExecutableDirs: () => ['/usr/bin']
}))

import { liveNotificationCount, notifyUser, quickOpen } from '../../src/main/desktop'

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
