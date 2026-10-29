import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { closeApp, closeBounded, createSandbox, launchApp } from '../e2e/helpers'

vi.mock('@playwright/test', () => ({ _electron: { launch: vi.fn() }, expect: vi.fn() }))

afterEach(() => vi.useRealTimers())

describe('Electron cleanup helpers', () => {
  const exitedApp = (): ElectronApplication => ({
    process: () => { throw new TypeError("Cannot read properties of undefined (reading '_object')") },
    close: async () => undefined
  }) as unknown as ElectronApplication

  it('closes an already-exited application through either helper', async () => {
    expect(await closeApp(exitedApp())).toBeLessThan(100)
    await expect(closeBounded(exitedApp())).resolves.toBeUndefined()
  })

  it('cancels the fallback timer after a normal close', async () => {
    vi.useFakeTimers()
    const app = {
      process: () => ({ exitCode: 0, signalCode: null }),
      close: async () => undefined
    } as unknown as ElectronApplication
    await closeBounded(app)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases inherited stdio after process exit so Playwright can observe close', async () => {
    const proc = spawn(process.execPath, ['-e', `
      const { spawn } = require('node:child_process')
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true, windowsHide: true })
      console.log(child.pid)
      child.unref()
    `])
    const exited = once(proc, 'exit')
    const closed = once(proc, 'close')
    const [output] = await once(proc.stdout, 'data')
    const descendant = Number(String(output).trim())
    if (!Number.isSafeInteger(descendant) || descendant <= 0) throw new Error('Child did not report its pid')
    const app = {
      process: () => proc,
      evaluate: async () => proc.pid,
      context: () => Object.assign(new EventEmitter(), { isClosed: () => false }),
      firstWindow: async () => ({ waitForSelector: async () => undefined }),
      close: async () => { await closed }
    } as unknown as ElectronApplication
    vi.mocked(electron.launch).mockResolvedValueOnce(app)
    try {
      await launchApp(createSandbox())
      await exited
      expect(await closeApp(app)).toBeLessThan(1000)
      expect(proc.stdout.destroyed).toBe(true)
      expect(proc.stderr.destroyed).toBe(true)
    } finally {
      vi.useRealTimers()
      try { process.kill(descendant) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
      await closed
    }
  })

  it.runIf(process.platform === 'win32')('reclaims a launcher only after the real app exits, even if its context never closes', async () => {
    const main = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true })
    const mainPid = main.pid!
    const mainClosed = once(main, 'close')
    const proc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true })
    const closed = once(proc, 'close')
    const context = Object.assign(new EventEmitter(), { isClosed: () => false })
    const app = {
      process: () => proc,
      evaluate: async () => mainPid,
      context: () => context,
      firstWindow: async () => ({ waitForSelector: async () => undefined }),
      close: async () => { await closed }
    } as unknown as ElectronApplication
    vi.mocked(electron.launch).mockResolvedValueOnce(app)
    let fallbackNeeded = false
    const fallback = setTimeout(() => { fallbackNeeded = true; proc.kill() }, 5000)
    try {
      await launchApp(createSandbox())
      const closing = closeApp(app)
      await new Promise((resolve) => setTimeout(resolve, 120))
      expect(() => process.kill(proc.pid!, 0)).not.toThrow()
      main.kill()
      await mainClosed
      await closing
      expect(fallbackNeeded).toBe(false)
      expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true)
    } finally {
      clearTimeout(fallback)
      if (main.exitCode === null && main.signalCode === null) main.kill()
      if (proc.exitCode === null && proc.signalCode === null) proc.kill()
      await Promise.all([mainClosed, closed])
    }
  })
})
