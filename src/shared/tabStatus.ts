import { SESSION_STATE_LABELS, type SessionState } from './sessionState'
import { sessionAge } from './sidebarModel'

export interface TabStatus {
  /** What the tab says after the name: a state word, or how long ago an idle session was last active. */
  text: string
  /** Idle tabs are quiet and muted; the rest wear their state colour. */
  quiet: boolean
}

/** A tab says Working, Needs you, Done or Exited; an idle one says "12m" or "3h" (and nothing while it is the open tab). */
export function tabStatus(state: SessionState, since: number, now: number, selected: boolean): TabStatus {
  if (state !== 'idle') return { text: SESSION_STATE_LABELS[state], quiet: false }
  return { text: selected ? '' : sessionAge(since, now), quiet: true }
}

/** Whether a tab shows its plan progress: always while it works, and on the open tab. */
export const showsTabPlan = (state: SessionState, selected: boolean, hasPlan: boolean): boolean => hasPlan && (selected || state === 'working')

/** A finished reply nobody has read yet makes the tab's name brighter. */
export const tabNameStrong = (state: SessionState, unread: boolean): boolean => state === 'done' && unread
