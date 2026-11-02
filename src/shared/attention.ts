export type Attention = 'none' | 'done' | 'needs'
export type ObservedStatus = 'busy' | 'idle' | 'exited'

/** A prompt that disappears for less than this (a redraw, a hidden terminal) still counts as the same prompt. */
export const NEEDS_GRACE_MS = 10_000
/** A pane the user has not looked at is not announced again sooner than this, however often its prompt comes back. */
export const NEEDS_RENOTIFY_MS = 120_000

export interface AttentionMemory {
  status: ObservedStatus | null
  attention: Attention
  /** When a prompt was last seen; drives the grace period. */
  waitingAt?: number | null
  /** When "needs you" was last announced and not yet seen by the user. */
  notifiedAt?: number | null
}

export interface AttentionObservation {
  status: ObservedStatus
  waiting: boolean
  focused: boolean
  visible: boolean
  windowFocused: boolean
  /** Current time. Without it there is no grace period or cooldown. */
  now?: number
}

export interface AttentionStep {
  memory: AttentionMemory
  notify: 'done' | 'needs' | null
}

export const initialAttention = (): AttentionMemory => ({ status: null, attention: 'none', waitingAt: null, notifiedAt: null })

function withinGrace(memory: AttentionMemory, now: number | undefined): boolean {
  return memory.attention === 'needs' && now !== undefined && memory.waitingAt != null && now - memory.waitingAt < NEEDS_GRACE_MS
}

function coolingDown(memory: AttentionMemory, now: number | undefined): boolean {
  return now !== undefined && memory.notifiedAt != null && now - memory.notifiedAt < NEEDS_RENOTIFY_MS
}

export function stepAttention(memory: AttentionMemory, obs: AttentionObservation): AttentionStep {
  const watching = obs.focused && obs.windowFocused
  const needs = obs.waiting && obs.status !== 'exited'
  const finished = memory.status === 'busy' && obs.status === 'idle'
  const waitingAt = needs ? (obs.now ?? null) : (memory.waitingAt ?? null)
  let attention: Attention = 'none'
  let event: 'done' | 'needs' | null = null
  if (obs.status === 'exited' || watching) {
    attention = 'none'
  } else if (needs || withinGrace(memory, obs.now)) {
    attention = 'needs'
    if (memory.attention !== 'needs' && !coolingDown(memory, obs.now)) event = 'needs'
  } else if (memory.attention === 'done' && obs.status === 'idle') {
    attention = 'done'
  } else if (finished) {
    attention = 'done'
    event = 'done'
  }
  const notify = event !== null && (!obs.windowFocused || !obs.visible) ? event : null
  const notifiedAt = watching ? null : notify === 'needs' ? (obs.now ?? null) : (memory.notifiedAt ?? null)
  return { memory: { status: obs.status, attention, waitingAt: watching ? null : waitingAt, notifiedAt }, notify }
}

export function nextAttentionPane(
  order: readonly string[],
  focusedId: string | null,
  attention: Readonly<Record<string, Attention>>
): string | null {
  const start = focusedId ? order.indexOf(focusedId) : -1
  const rotated = order.map((_, i) => order[(start + 1 + i) % order.length])
  return rotated.find((id) => attention[id] === 'needs') ?? rotated.find((id) => attention[id] === 'done') ?? null
}
