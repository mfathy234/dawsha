export type LinkPhase = 'off' | 'connecting' | 'on' | 'dropped' | 'reconnecting'

export interface LinkSnapshot {
  phase: LinkPhase
  droppedAt: number | null
  changedAt: number | null
  attempt: number
}

export const RECONNECT_DELAYS_MS: readonly number[] = [0, 5_000, 15_000, 45_000, 120_000]

export function reconnectDelay(attempt: number, delays: readonly number[] = RECONNECT_DELAYS_MS): number | null {
  return Number.isInteger(attempt) && attempt >= 0 && attempt < delays.length ? delays[attempt]! : null
}

export function createLinkMachine(now: () => number = Date.now) {
  let current: LinkSnapshot = { phase: 'off', droppedAt: null, changedAt: null, attempt: 0 }

  function move(allowed: LinkPhase[], next: Partial<LinkSnapshot> & { phase: LinkPhase }): boolean {
    if (!allowed.includes(current.phase)) return false
    current = { ...current, ...next }
    return true
  }

  return {
    snapshot: (): LinkSnapshot => current,
    start: () => move(['off'], { phase: 'connecting', droppedAt: null, changedAt: null, attempt: 0 }),
    up: () => move(['connecting', 'reconnecting'], { phase: 'on', droppedAt: null, changedAt: now(), attempt: 0 }),
    drop: () => move(['on', 'connecting'], { phase: 'dropped', droppedAt: now(), attempt: 0 }),
    recovered: () => move(['dropped'], { phase: 'on', droppedAt: null, attempt: 0 }),
    reconnecting: () => move(['dropped', 'on'], { phase: 'reconnecting', droppedAt: current.droppedAt ?? now() }),
    attemptFailed: () => move(['reconnecting'], { phase: 'dropped', attempt: current.attempt + 1 }),
    stop: () => {
      current = { phase: 'off', droppedAt: null, changedAt: null, attempt: 0 }
      return true
    }
  }
}

export type LinkMachine = ReturnType<typeof createLinkMachine>
