import { api } from './api'
import { acknowledgeAttention } from './attention'
import { answerPermission, closePane, focusPane, permissionTail } from './actions'
import { detectPermissionPrompt } from '../shared/permissionPrompt'
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
  // Enter on a permission prompt picks its default answer, so a reply must never be typed into one.
  if (store.state.attention[paneId] === 'needs' || detectPermissionPrompt(permissionTail(paneId))) {
    toast(`Answer the permission in ${view.title} first.`)
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
  // A session may have started working or asked for permission while the dialog was open; leave those alone.
  const stillReviewed = new Set(
    derivePanes(store.state)
      .filter((view) => view.status !== 'busy' && store.state.attention[view.pane.id] !== 'needs')
      .map((view) => view.pane.id)
  )
  for (const id of paneIds) if (stillReviewed.has(id)) await closePane(id)
}

/** Answers a card's permission prompt, or opens the session when the prompt can't be read from the screen. */
export function answerFromCard(paneId: string, allow: boolean): void {
  if (answerPermission(paneId, allow)) return
  toast('This prompt can’t be answered from the card. Opened the session so you can answer it there.')
  openPeek(paneId)
}
