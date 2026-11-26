import { miniSendRefusal } from '../shared/miniSend'
import { permissionTail } from './actions'
import { sendChatMessage } from './chat/chatActions'
import { toast } from './components/toast'
import { derivePanes, primaryTab } from './derive'
import { store } from './state'

/**
 * Types a message into a session the way the chat box does. A session that is gone, has exited, shows a menu or waits for an answer
 * refuses it. Returns the refusal, or null when the message went in.
 */
export function sendToSession(paneId: string, text: string): string | null {
  const view = derivePanes(store.state).find((candidate) => candidate.pane.id === paneId)
  const tab = view ? primaryTab(view.pane) : null
  if (!view || !tab) return 'That session is gone.'
  const refusal = miniSendRefusal({ agent: tab.agent, status: tab.status, tail: permissionTail(paneId) })
  if (refusal) return refusal
  // A prompt can appear between typing and the delayed Enter; that Enter would approve it.
  sendChatMessage(tab.id, tab.agent, text, () => {
    const late = miniSendRefusal({ agent: tab.agent, status: tab.status, tail: permissionTail(paneId) })
    if (late) toast(late)
    return !late
  })
  return null
}
