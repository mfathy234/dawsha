import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { armHardDeadline, bounded, runPhases, runQuit, type ShutdownDeps } from '../../src/main/shutdown'

const never = (): Promise<void> => new Promise(() => undefined)

function makeDeps(overrides: Partial<ShutdownDeps> = {}): ShutdownDeps & { lines: string[]; exits: number[]; calls: string[] } {
  const lines: string[] = []
  const exits: number[] = []
  const calls: string[] = []
  return {
    lines,
    exits,
    calls,
    log: (message) => lines.push(message),
    stopServices: () => void calls.push('stop'),
    flushRenderer: async () => void calls.push('flush'),
    terminateAll: async () => void calls.push('terminate'),
    flushStorage: async () => void calls.push('storage'),
    finish: () => void calls.push('finish'),
    exit: (code) => void exits.push(code),
    ...overrides
  }
}

describe('shutdown', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('bounded reports done, error and timeout', async () => {
    expect(await bounded(async () => undefined, 100)).toBe('done')
    expect(await bounded(async () => Promise.reject(new Error('x')), 100)).toBe('error')
    const pending = bounded(never, 100)
    await vi.advanceTimersByTimeAsync(100)
    expect(await pending).toBe('timeout')
  })

  it('runs the phases in order and finishes', async () => {
    const deps = makeDeps()
    const quit = runQuit(deps)
    await vi.advanceTimersByTimeAsync(0)
    await quit
    expect(deps.calls).toEqual(['stop', 'flush', 'terminate', 'storage', 'finish'])
    expect(deps.lines).toContain('flush done')
    expect(deps.lines).toContain('terminateAll done')
  })

  it('awaits async service cleanup before flushing renderer state', async () => {
    let completeStop: (() => void) | undefined
    const deps = makeDeps({ stopServices: () => new Promise<void>((resolve) => { completeStop = resolve }) })
    const quit = runQuit(deps)
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.calls).toEqual([])
    completeStop?.()
    await vi.advanceTimersByTimeAsync(0)
    await quit
    expect(deps.calls).toEqual(['flush', 'terminate', 'storage', 'finish'])
  })

  it('moves on when the renderer never answers the flush', async () => {
    const deps = makeDeps({ flushRenderer: never })
    const quit = runQuit(deps)
    await vi.advanceTimersByTimeAsync(1000)
    await quit
    expect(deps.lines).toContain('flush timeout')
    expect(deps.calls).toEqual(['stop', 'terminate', 'storage', 'finish'])
  })

  it('moves on when the process kill never settles', async () => {
    const deps = makeDeps({ terminateAll: never })
    const quit = runQuit(deps)
    await vi.advanceTimersByTimeAsync(2500)
    await quit
    expect(deps.lines).toContain('terminateAll timeout')
    expect(deps.calls).toContain('finish')
  })

  it('moves on when flushing the storage never settles', async () => {
    const deps = makeDeps({ flushStorage: never })
    const quit = runQuit(deps)
    await vi.advanceTimersByTimeAsync(1000)
    await quit
    expect(deps.lines).toContain('flushStorage timeout')
    expect(deps.calls).toContain('finish')
  })

  it('survives a throwing phase and a throwing stop', async () => {
    const deps = makeDeps({
      stopServices: () => {
        throw new Error('stop failed')
      },
      flushRenderer: async () => Promise.reject(new Error('boom'))
    })
    await runPhases(deps)
    expect(deps.lines).toContain('flush error')
    expect(deps.lines.some((line) => line.includes('stop failed'))).toBe(true)
    expect(deps.calls).toEqual(['terminate', 'storage'])
  })

  it('exits unconditionally at the hard deadline when finish never completes the quit', async () => {
    const deps = makeDeps({ hardDeadlineMs: 8000 })
    await runQuit(deps)
    expect(deps.exits).toEqual([])
    await vi.advanceTimersByTimeAsync(8000)
    expect(deps.exits).toEqual([0])
    expect(deps.lines).toContain('app.exit called (hard deadline)')
  })

  it('exits at the hard deadline even when every phase hangs forever', async () => {
    const deps = makeDeps({ flushRenderer: never, terminateAll: never, finish: never, hardDeadlineMs: 3000 })
    void runQuit(deps)
    await vi.advanceTimersByTimeAsync(3000)
    expect(deps.exits).toEqual([0])
  })

  it('exits right away when finish throws', async () => {
    const deps = makeDeps({
      finish: () => {
        throw new Error('install failed')
      }
    })
    await runQuit(deps)
    expect(deps.exits).toEqual([0])
    expect(deps.lines).toContain('app.exit called (error)')
  })

  it('can arm the deadline on its own for the restart path', async () => {
    const deps = makeDeps({ hardDeadlineMs: 500 })
    armHardDeadline(deps)
    await vi.advanceTimersByTimeAsync(500)
    expect(deps.exits).toEqual([0])
  })
})
