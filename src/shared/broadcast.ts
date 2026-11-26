import type { SessionState } from './sessionState'

export const BROADCAST_MAX = 8000

export interface BroadcastSession {
  paneId: string
  name: string
  project: string
  projectId: string
  state: SessionState
  /** A shell has no agent to receive a message. */
  agent: string
}

/** Now for a session waiting at its prompt, after its turn for a working one, never for the rest. */
export type BroadcastPlan = 'now' | 'later' | 'skip'

export function planFor(session: Pick<BroadcastSession, 'state' | 'agent'>): BroadcastPlan {
  if (session.agent === 'shell') return 'skip'
  if (session.state === 'working') return 'later'
  if (session.state === 'needs' || session.state === 'exited') return 'skip'
  return 'now'
}

export function planNote(session: Pick<BroadcastSession, 'state' | 'agent'>): string {
  const plan = planFor(session)
  if (session.agent === 'shell') return 'Terminal · skipped'
  if (plan === 'later') return 'Working · after it finishes'
  if (session.state === 'needs') return 'Needs you · skipped'
  if (session.state === 'exited') return 'Exited · skipped'
  return session.state === 'done' ? 'Done' : 'Idle'
}

export type BroadcastFilter = { kind: 'idle' } | { kind: 'project'; projectId: string } | { kind: 'all' }

/** The sessions a quick filter ticks; sessions that would be skipped are never ticked. */
export function ticked(sessions: readonly BroadcastSession[], filter: BroadcastFilter): Set<string> {
  const sendable = sessions.filter((session) => planFor(session) !== 'skip')
  const chosen = filter.kind === 'idle' ? sendable.filter((session) => planFor(session) === 'now')
    : filter.kind === 'project' ? sendable.filter((session) => session.projectId === filter.projectId)
      : sendable
  return new Set(chosen.map((session) => session.paneId))
}

/** How many of the ticked sessions get the message, now or later. */
export function sendCount(sessions: readonly BroadcastSession[], picked: ReadonlySet<string>): number {
  return sessions.filter((session) => picked.has(session.paneId) && planFor(session) !== 'skip').length
}

export function sendLabel(count: number): string {
  return count === 1 ? 'Send to 1 session' : `Send to ${count} sessions`
}

export interface BroadcastSplit {
  now: string[]
  later: string[]
}

export function splitTargets(sessions: readonly BroadcastSession[], picked: ReadonlySet<string>): BroadcastSplit {
  const chosen = sessions.filter((session) => picked.has(session.paneId))
  return {
    now: chosen.filter((session) => planFor(session) === 'now').map((session) => session.paneId),
    later: chosen.filter((session) => planFor(session) === 'later').map((session) => session.paneId)
  }
}

export interface PendingSend {
  paneId: string
  text: string
}

/** Which waiting messages can go out: the session's turn ended and it does not need the owner. */
export function dueSends(pending: readonly PendingSend[], states: ReadonlyMap<string, SessionState>): { due: PendingSend[]; keep: PendingSend[]; dropped: PendingSend[] } {
  const due: PendingSend[] = []
  const keep: PendingSend[] = []
  const dropped: PendingSend[] = []
  for (const item of pending) {
    const state = states.get(item.paneId)
    if (state === undefined || state === 'exited') dropped.push(item)
    else if (state === 'idle' || state === 'done') due.push(item)
    else keep.push(item)
  }
  return { due, keep, dropped }
}
