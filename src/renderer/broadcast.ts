import { dueSends, splitTargets, type BroadcastSession, type PendingSend } from '../shared/broadcast'
import { sendToSession } from './sendToSession'
import { toast } from './components/toast'
import { derivePanes } from './derive'
import { store } from './state'
import { viewState } from './components/sidebarRows'

const TICK_MS = 1000
const SETTLED_TICKS = 2

let pending: PendingSend[] = []
const settled = new Map<string, number>()

export function broadcastSessions(): BroadcastSession[] {
  const state = store.state
  return derivePanes(state)
    .filter((view) => !view.snoozed)
    .map((view) => ({ paneId: view.pane.id, name: view.title, project: view.project?.name ?? '', projectId: view.pane.projectId, state: viewState(view), agent: view.agent }))
}

export const pendingFor = (paneId: string): boolean => pending.some((item) => item.paneId === paneId)

/** Sends now to the sessions at their prompt, and keeps the message for the working ones until their turn ends. */
export function sendToMany(text: string, picked: ReadonlySet<string>): { sent: number; waiting: number } {
  const split = splitTargets(broadcastSessions(), picked)
  let sent = 0
  for (const paneId of split.now) {
    const refusal = sendToSession(paneId, text)
    if (refusal) toast(refusal)
    else sent += 1
  }
  pending = [...pending.filter((item) => !split.later.includes(item.paneId)), ...split.later.map((paneId) => ({ paneId, text }))]
  return { sent, waiting: split.later.length }
}

function tick(): void {
  if (pending.length === 0) return
  const states = new Map(broadcastSessions().map((session) => [session.paneId, session.state]))
  for (const view of derivePanes(store.state)) if (view.snoozed) states.set(view.pane.id, viewState(view))
  const { due, keep, dropped } = dueSends(pending, states)
  const stable = due.filter((item) => {
    const ticks = (settled.get(item.paneId) ?? 0) + 1
    settled.set(item.paneId, ticks)
    return ticks >= SETTLED_TICKS
  })
  for (const item of keep) settled.delete(item.paneId)
  const unsettled = due.filter((item) => !stable.includes(item))
  pending = [...keep, ...unsettled]
  for (const item of stable) {
    settled.delete(item.paneId)
    const refusal = sendToSession(item.paneId, item.text)
    if (refusal) toast(refusal)
  }
  if (dropped.length > 0) toast(`${dropped.length} waiting message${dropped.length === 1 ? '' : 's'} not sent: the session closed.`, 'info')
}

/** Delivers messages that waited for a session's turn to end. */
export function installBroadcastQueue(): void {
  window.setInterval(tick, TICK_MS)
}
