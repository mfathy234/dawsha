import { focusPaneFromNotification } from './actions'
import { derivePanes } from './derive'
import { recordNotification } from './notificationHistory'
import { needsMessage, newlyNeeding } from '../shared/notifications'
import { store, type AppState } from './state'

let known = new Set<string>()
let lastAttention: AppState['attention'] | null = null

function check(state: AppState): void {
  if (state.attention === lastAttention) return
  lastAttention = state.attention
  const current = Object.keys(state.attention).filter((id) => state.attention[id] === 'needs')
  const fresh = newlyNeeding(known, current)
  known = new Set(current)
  if (fresh.length === 0) return
  for (const view of derivePanes(state)) {
    const paneId = view.pane.id
    if (!fresh.includes(paneId)) continue
    recordNotification(needsMessage(view.title, view.project?.name ?? null), 'needs', {
      label: 'Go to session',
      run: () => focusPaneFromNotification(paneId),
      valid: () => store.state.panes.some((pane) => pane.id === paneId)
    })
  }
}

/** Puts a line in the notification history the moment a session starts needing the user, once per transition. */
export function installNeedsNotices(): void {
  store.subscribe(check)
}
