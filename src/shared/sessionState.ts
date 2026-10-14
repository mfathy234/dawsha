import type { Attention } from './attention'

export type SessionState = 'needs' | 'working' | 'done' | 'idle' | 'exited'

export interface SessionStateInput {
  status: 'busy' | 'idle' | 'exited'
  attention: Attention
}

export const SESSION_STATE_LABELS: Record<SessionState, string> = {
  needs: 'Needs you',
  working: 'Working',
  done: 'Done',
  idle: 'Idle',
  exited: 'Exited'
}

/** Most urgent first: the order the sidebar, others panel and top bar sort by. */
export const SESSION_STATE_ORDER: readonly SessionState[] = ['needs', 'done', 'working', 'idle', 'exited']

export function sessionState(input: SessionStateInput): SessionState {
  if (input.attention === 'needs') return 'needs'
  if (input.status === 'exited') return 'exited'
  if (input.status === 'busy') return 'working'
  if (input.attention === 'done') return 'done'
  return 'idle'
}

export interface SessionCounts {
  total: number
  needs: number
  working: number
  done: number
}

export function countSessionStates(states: readonly SessionState[]): SessionCounts {
  return {
    total: states.length,
    needs: states.filter((s) => s === 'needs').length,
    working: states.filter((s) => s === 'working').length,
    done: states.filter((s) => s === 'done').length
  }
}

export const compareSessionStates = (a: SessionState, b: SessionState): number =>
  SESSION_STATE_ORDER.indexOf(a) - SESSION_STATE_ORDER.indexOf(b)

export interface StateClock {
  state: SessionState
  since: number
}

/** Remembers when a session entered its current state. Same state keeps the same object. */
export function stepStateClock(previous: StateClock | undefined, state: SessionState, now: number): StateClock {
  return previous && previous.state === state ? previous : { state, since: now }
}

/**
 * How long a session has been in its state, in whole minutes or more. Under a minute it is empty:
 * a seconds counter would change the label on every update and make the pill jitter.
 */
export function formatTimeInState(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return ''
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
