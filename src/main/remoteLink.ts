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

/** A link that stays up this long has proved itself, so its next drop starts the backoff over. */
export const STABLE_UP_MS = 120_000
export const MIN_RECONNECT_INTERVAL_MS = 5_000

export function createLinkMachine(now: () => number = Date.now, minIntervalMs = MIN_RECONNECT_INTERVAL_MS) {
  let current: LinkSnapshot = { phase: 'off', droppedAt: null, changedAt: null, attempt: 0 }
  let upSince: number | null = null
  let lastAttemptAt: number | null = null

  function move(allowed: LinkPhase[], next: Partial<LinkSnapshot> & { phase: LinkPhase }): boolean {
    if (!allowed.includes(current.phase)) return false
    current = { ...current, ...next }
    return true
  }

  return {
    snapshot: (): LinkSnapshot => current,
    start: () => {
      upSince = null
      lastAttemptAt = null
      return move(['off'], { phase: 'connecting', droppedAt: null, changedAt: null, attempt: 0 })
    },
    up: () => {
      const moved = move(['connecting', 'reconnecting'], { phase: 'on', droppedAt: null, changedAt: now() })
      if (moved) upSince = now()
      return moved
    },
    drop: () => {
      const stable = upSince !== null && now() - upSince >= STABLE_UP_MS
      return move(['on', 'connecting'], { phase: 'dropped', droppedAt: now(), attempt: stable ? 0 : current.attempt })
    },
    recovered: () => {
      const moved = move(['dropped'], { phase: 'on', droppedAt: null })
      if (moved) upSince = now()
      return moved
    },
    reconnecting: () => {
      const moved = move(['dropped', 'on'], { phase: 'reconnecting', droppedAt: current.droppedAt ?? now() })
      if (moved) lastAttemptAt = now()
      return moved
    },
    attemptFailed: () => move(['reconnecting'], { phase: 'dropped', attempt: current.attempt + 1 }),
    /** Milliseconds to wait before the next reconnect attempt may start, so a flapping link cannot be retried in a burst. */
    gapMs: (): number => (lastAttemptAt === null ? 0 : Math.max(0, lastAttemptAt + minIntervalMs - now())),
    /** Called when the schedule is used up, so the next drop starts it again instead of giving up at once. */
    restartSchedule: () => {
      current = { ...current, attempt: 0 }
      return true
    },
    stop: () => {
      upSince = null
      lastAttemptAt = null
      current = { phase: 'off', droppedAt: null, changedAt: null, attempt: 0 }
      return true
    }
  }
}

export type LinkMachine = ReturnType<typeof createLinkMachine>
