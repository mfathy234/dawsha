import { permissionPromptText } from '../shared/permissionPrompt'
import type { SessionState } from '../shared/sessionState'
import type { TimelineEvent } from '../shared/timeline'

const MAX_EVENTS = 500

const logs = new Map<string, TimelineEvent[]>()

function append(paneId: string, event: Omit<TimelineEvent, 'id'>): void {
  const list = logs.get(paneId) ?? []
  const next = [...list, { ...event, id: `local-${list.length}` }]
  logs.set(paneId, next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next)
}

/** Remembers a pane's session state change. Repeating the current state records nothing. */
export function recordState(paneId: string, state: SessionState, at: number): void {
  const last = [...(logs.get(paneId) ?? [])].reverse().find((event) => event.kind === 'state')
  if (last?.state === state) return
  append(paneId, { at, kind: 'state', text: state, state })
}

/** Remembers a permission answered from this app, with the prompt's command when the screen showed one. */
export function recordApproval(paneId: string, allowed: boolean, screen: string, at: number): void {
  append(paneId, { at, kind: 'approval', allowed, source: 'desktop', text: permissionPromptText(screen) })
}

export const localEvents = (paneId: string): readonly TimelineEvent[] => logs.get(paneId) ?? []

export function forgetTimelineLogs(liveIds: ReadonlySet<string>): void {
  for (const id of logs.keys()) if (!liveIds.has(id)) logs.delete(id)
}
