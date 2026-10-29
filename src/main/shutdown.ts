import type { QuitLog } from './quitLog'

export const FLUSH_TIMEOUT_MS = 1000
export const KILL_TIMEOUT_MS = 2000
export const STORAGE_TIMEOUT_MS = 1000
export const HARD_DEADLINE_MS = 8000
export const WATCHDOG_GRACE_MS = 500
export const STOP_SERVICES_TIMEOUT_MS = 2500

export interface ShutdownDeps {
  log: QuitLog
  stopServices(): void | Promise<void>
  flushRenderer(): Promise<void>
  terminateAll(timeoutMs: number): Promise<void>
  flushStorage(): Promise<void>
  finish(): void
  exit(code: number): void
  flushTimeoutMs?: number
  killTimeoutMs?: number
  storageTimeoutMs?: number
  hardDeadlineMs?: number
}

export type PhaseResult = 'done' | 'timeout' | 'error'

export function exitProcess(code: number, deps: Pick<ShutdownDeps, 'exit' | 'log'>, platform = process.platform, kill = process.kill): void {
  deps.log(`terminating the process (code ${code})`)
  // Windows needs Electron to release Chromium's children and the launcher's pipes.
  if (platform !== 'win32') {
    try { kill(process.pid, 'SIGKILL') } catch (error) {
      deps.log(`self kill failed: ${(error as Error).message}`)
    }
  }
  deps.exit(code)
}

export async function bounded(work: () => Promise<void>, timeoutMs: number): Promise<PhaseResult> {
  let timer: NodeJS.Timeout | undefined
  const limit = new Promise<PhaseResult>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  const run = Promise.resolve()
    .then(work)
    .then((): PhaseResult => 'done')
    .catch((): PhaseResult => 'error')
  const result = await Promise.race([run, limit])
  clearTimeout(timer)
  return result
}

async function phase(deps: ShutdownDeps, name: string, work: () => Promise<void>, timeoutMs: number): Promise<void> {
  deps.log(`${name} requested`)
  deps.log(`${name} ${await bounded(work, timeoutMs)}`)
}

export async function runPhases(deps: ShutdownDeps): Promise<void> {
  const stopResult = await bounded(async () => {
    try { await deps.stopServices() } catch (error) {
      deps.log(`stop services failed: ${(error as Error).message}`)
      throw error
    }
  }, STOP_SERVICES_TIMEOUT_MS)
  deps.log(`stop services ${stopResult}`)
  await phase(deps, 'flush', deps.flushRenderer, deps.flushTimeoutMs ?? FLUSH_TIMEOUT_MS)
  const kill = deps.killTimeoutMs ?? KILL_TIMEOUT_MS
  await phase(deps, 'terminateAll', () => deps.terminateAll(kill), kill + 500)
  await phase(deps, 'flushStorage', deps.flushStorage, deps.storageTimeoutMs ?? STORAGE_TIMEOUT_MS)
}

export function exitNow(deps: ShutdownDeps, reason: string): void {
  deps.log(`app.exit called (${reason})`)
  deps.exit(0)
}

export function armHardDeadline(deps: ShutdownDeps): NodeJS.Timeout {
  return setTimeout(() => exitNow(deps, 'hard deadline'), deps.hardDeadlineMs ?? HARD_DEADLINE_MS)
}

export async function runQuit(deps: ShutdownDeps): Promise<void> {
  armHardDeadline(deps)
  try {
    await runPhases(deps)
    deps.log('finish requested')
    deps.finish()
    deps.log('finish returned')
  } catch (error) {
    deps.log(`shutdown failed: ${(error as Error).message}`)
    exitNow(deps, 'error')
  }
}
