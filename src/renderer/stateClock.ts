import { formatTimeInState, stepStateClock, type SessionState, type StateClock } from '../shared/sessionState'

const clocks = new Map<string, StateClock>()

/** Time a pane has spent in its current state, e.g. "3m"; empty under a minute. */
export function timeInState(paneId: string, state: SessionState, now: number): string {
  const clock = stepStateClock(clocks.get(paneId), state, now)
  clocks.set(paneId, clock)
  return formatTimeInState(now - clock.since)
}

export function forgetStateClocks(liveIds: ReadonlySet<string>): void {
  for (const id of clocks.keys()) if (!liveIds.has(id)) clocks.delete(id)
}
