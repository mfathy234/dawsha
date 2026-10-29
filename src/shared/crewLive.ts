import type { SessionState } from './sessionState'

export type AvatarState = 'idle' | 'working' | 'needs' | 'done' | 'failed'

export const AVATAR_LABELS: Record<AvatarState, string> = {
  idle: 'Idle',
  working: 'Working',
  needs: 'Needs you',
  done: 'Done',
  failed: 'Failed'
}

export const AVATAR_BADGES: Record<AvatarState, string> = { idle: '', working: '⟳', needs: '!', done: '✓', failed: '✕' }

export const DONE_VISIBLE_MS = 10 * 60_000
export const START_GRACE_MS = 15_000

export interface RunTrack {
  state: AvatarState
  since: number
  busySeen: boolean
  seen: boolean
}

export interface TrackInput {
  session: SessionState
  tab: 'starting' | 'running' | 'exited'
  exitCode?: number
  startedAt: number
  now: number
}

const next = (prev: RunTrack | undefined, state: AvatarState, now: number, busySeen: boolean): RunTrack =>
  prev && prev.state === state ? { ...prev, busySeen } : { state, since: now, busySeen, seen: false }

/** Follows one run through its session states. Done is remembered once the work was seen going busy, so a quick run still ends as Done. */
export function stepTrack(prev: RunTrack | undefined, input: TrackInput): RunTrack {
  const busy = prev?.busySeen ?? false
  if (input.tab === 'exited') {
    if (prev?.state === 'failed') return prev
    return next(prev, input.exitCode !== undefined && input.exitCode !== 0 ? 'failed' : 'done', input.now, busy)
  }
  if (input.session === 'needs') return next(prev, 'needs', input.now, true)
  if (input.session === 'working') return next(prev, 'working', input.now, true)
  if (input.tab === 'starting') return next(prev, 'working', input.now, busy)
  if (busy) return next(prev, 'done', input.now, true)
  if (input.now - input.startedAt < START_GRACE_MS) return next(prev, 'working', input.now, false)
  return next(prev, 'idle', input.now, false)
}

export function visibleState(track: RunTrack | undefined, now: number): AvatarState {
  if (!track) return 'idle'
  if (track.state === 'done' && (track.seen || now - track.since > DONE_VISIBLE_MS)) return 'idle'
  return track.state
}

const URGENCY: readonly AvatarState[] = ['needs', 'failed', 'working', 'done', 'idle']

export const compareAvatarStates = (a: AvatarState, b: AvatarState): number => URGENCY.indexOf(a) - URGENCY.indexOf(b)

export function memberState(states: readonly AvatarState[]): AvatarState {
  return [...states].sort(compareAvatarStates)[0] ?? 'idle'
}

export function stripSummary(states: readonly AvatarState[]): string {
  const count = (state: AvatarState): number => states.filter((s) => s === state).length
  return [
    count('needs') > 0 ? `${count('needs')} needs you` : '',
    count('failed') > 0 ? `${count('failed')} failed` : '',
    count('working') > 0 ? `${count('working')} working` : '',
    count('done') > 0 ? `${count('done')} done` : ''
  ]
    .filter((part) => part !== '')
    .join(' · ')
}

export function formatCost(costUsd: number | null): string {
  return costUsd === null ? '' : costUsd < 0.005 ? '<$0.01' : `$${costUsd.toFixed(2)}`
}

export function formatSpan(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
