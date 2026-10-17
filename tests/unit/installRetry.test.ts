import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { isTransientInstallError, renameWithRetry, withRetry } from '../../src/main/installRetry'

describe('installer retry helpers', () => {
  it('classifies network, server and digest failures as transient but not policy failures', () => {
    expect(isTransientInstallError(new Error('fetch failed'))).toBe(true)
    expect(isTransientInstallError(new Error('Cloudflare release request timed out.'))).toBe(true)
    expect(isTransientInstallError(new Error('Cloudflare Tunnel request failed with HTTP 503.'))).toBe(true)
    expect(isTransientInstallError(new Error('Cloudflare Tunnel SHA-256 verification failed; the file was not installed.'))).toBe(true)
    expect(isTransientInstallError(new Error('Only the exact official Cloudflare release asset can be installed.'))).toBe(false)
    expect(isTransientInstallError(new Error('request failed with HTTP 404.'))).toBe(false)
  })

  it('retries transient failures with doubling backoff and then succeeds', async () => {
    const sleep = vi.fn(async (_ms: number) => undefined)
    const task = vi.fn(async (attempt: number) => { if (attempt < 3) throw new Error('fetch failed'); return 'ok' })
    await expect(withRetry(task, { attempts: 4, delayMs: 100, sleep })).resolves.toBe('ok')
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200])
  })

  it('does not retry policy failures and stops after the attempt limit', async () => {
    const policy = vi.fn(async () => { throw new Error('Only the exact official Cloudflare release asset can be installed.') })
    await expect(withRetry(policy, { attempts: 3, delayMs: 1, sleep: async () => undefined })).rejects.toThrow(/official/)
    expect(policy).toHaveBeenCalledOnce()
    const flaky = vi.fn(async () => { throw new Error('fetch failed') })
    await expect(withRetry(flaky, { attempts: 3, delayMs: 1, sleep: async () => undefined })).rejects.toThrow(/fetch failed/)
    expect(flaky).toHaveBeenCalledTimes(3)
  })

  it('renames a file and gives up immediately on non-lock errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dawsha-rename-'))
    try {
      await writeFile(join(dir, 'a'), 'x')
      await renameWithRetry(join(dir, 'a'), join(dir, 'b'), async () => undefined)
      expect(await readFile(join(dir, 'b'), 'utf8')).toBe('x')
      const sleep = vi.fn(async () => undefined)
      await expect(renameWithRetry(join(dir, 'missing'), join(dir, 'c'), sleep)).rejects.toThrow(/ENOENT/)
      expect(sleep).not.toHaveBeenCalled()
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
