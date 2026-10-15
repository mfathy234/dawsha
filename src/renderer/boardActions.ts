import { api } from './api'
import { acknowledgeAttention } from './attention'
import { closePane, focusPane } from './actions'
import { confirmDialog } from './components/dialogs'
import { toast } from './components/toast'
import { derivePanes } from './derive'
import { paneById, store } from './state'
import { getTerminal } from './terminals'

export function openPeek(paneId: string): void {
  if (!paneById(store.state, paneId) || store.state.boardPeekId === paneId) return
  store.patch({ boardPeekId: paneId })
}

export function closePeek(): void {
  if (store.state.boardPeekId !== null) store.patch({ boardPeekId: null })
}

export function markReviewed(paneId: string): void {
  acknowledgeAttention(paneId)
}

export function peekInGrid(paneId: string): void {
  closePeek()
  focusPane(paneId)
}

/** Sends a reply to the pane's agent terminal: typed in like a snippet, then Enter. */
export function sendReply(paneId: string, text: string): boolean {
  const reply = text.trim()
  const view = derivePanes(store.state).find((v) => v.pane.id === paneId)
  const terminal = view ? getTerminal(view.primaryTabId) : undefined
  if (!view || !terminal || reply === '') return false
  if (view.pane.tabs.find((t) => t.id === view.primaryTabId)?.status === 'exited') {
    toast(`${view.title} has exited. Restart it before replying.`)
    return false
  }
  terminal.insertText(reply)
  api.write(view.primaryTabId, '\r')
  return true
}

export async function closeReviewed(paneIds: readonly string[]): Promise<void> {
  const count = paneIds.length
  if (count === 0) return
  const noun = count === 1 ? 'session' : 'sessions'
  const confirmed = await confirmDialog({
    title: `Close ${count} reviewed ${noun}?`,
    body: `This closes ${count} reviewed ${noun} on the board. Their files stay on disk, and you can resume them from Resume a session.`,
    confirmLabel: `Close ${count} ${noun}`
  })
  if (!confirmed) return
  for (const id of paneIds) await closePane(id)
}
