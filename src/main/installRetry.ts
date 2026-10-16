import { rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

const TRANSIENT_NETWORK = /timed out|fetch failed|econn|enotfound|etimedout|eai_again|enetunreach|ehostunreach|socket|network|terminated|aborted|HTTP (5\d\d|429)|SHA-256/i
const LOCKED_FILE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])

export function isTransientInstallError(error: unknown): boolean {
  const cause = error && typeof error === 'object' && 'cause' in error ? String((error as { cause?: unknown }).cause) : ''
  return TRANSIENT_NETWORK.test(`${(error as Error)?.message ?? ''} ${cause}`)
}

export interface RetryOptions {
  attempts: number
  delayMs: number
  sleep?: (ms: number) => Promise<void>
  onRetry?: (attempt: number, error: unknown) => void
}

export async function withRetry<T>(task: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => delay(ms))
  for (let attempt = 1; ; attempt++) {
    try {
      return await task(attempt)
    } catch (error) {
      if (attempt >= options.attempts || !isTransientInstallError(error)) throw error
      options.onRetry?.(attempt, error)
      await sleep(options.delayMs * 2 ** (attempt - 1))
    }
  }
}

export async function renameWithRetry(from: string, to: string, sleep: (ms: number) => Promise<void> = (ms) => delay(ms), attempts = 8): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= attempts || !code || !LOCKED_FILE_CODES.has(code)) throw error
      await sleep(250 * attempt)
    }
  }
}
