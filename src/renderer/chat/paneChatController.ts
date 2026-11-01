import { chatCapable } from '../../shared/chatLog'
import type { SessionState } from '../../shared/sessionState'
import type { AgentKind } from '../../shared/types'
import { detectTerminalMenu } from '../../shared/terminalMenu'
import { folderOfPane, store } from '../state'
import { continueIn } from '../handoffActions'
import type { PaneView } from '../derive'
import { getTerminal } from '../terminals'
import { sessionIdOf } from '../transcriptActions'
import { interruptAgent, paneViewOf, primaryTab, rememberPending, sendChatMessage, setPaneView } from './chatActions'
import type { ChatHost, PaneChat } from './paneChat'
import type { ViewSwitch } from './viewSwitch'

const MENU_ROWS = 28

/** What a pane's chat does to the rest of the app: type into the terminal, switch views, hand off to the other agent. */
export function chatHostFor(paneId: string, current: () => PaneView | null): ChatHost {
  const tabId = (): string => current()?.primaryTabId ?? ''
  return {
    showTerminal: () => setPaneView(paneId, 'terminal'),
    continueIn: (to: AgentKind) => void continueIn(paneId, to),
    send: (text) => sendChatMessage(tabId(), text),
    interrupt: () => interruptAgent(tabId()),
    menuOpen: () => detectTerminalMenu(getTerminal(tabId())?.tailText(MENU_ROWS) ?? '')
  }
}

/** Brings a pane's header switch and chat up to date with its session. True when Chat is what the pane shows. */
export function syncPaneChat(paneId: string, view: PaneView, state: SessionState, asking: boolean, header: ViewSwitch, chat: PaneChat): boolean {
  const tab = primaryTab(view)
  if (!tab || !chatCapable(tab.agent)) {
    header.update(null, () => undefined)
    chat.update(null)
    return false
  }
  const chosen = paneViewOf(view)
  header.update(chosen, (next) => setPaneView(paneId, next))
  rememberPending(view)
  const shown = chosen === 'chat' && view.pane.activeTabId === tab.id
  const pane = store.state.panes.find((candidate) => candidate.id === paneId)
  const folder = pane ? (folderOfPane(store.state, pane) ?? '') : ''
  chat.update(
    shown
      ? {
          agent: tab.agent as AgentKind,
          sessionId: sessionIdOf(tab) ?? null,
          folder,
          project: view.project?.name ?? '',
          branch: view.branch ?? '',
          working: state === 'working',
          needsApproval: asking,
          exited: tab.status === 'exited'
        }
      : null
  )
  return shown
}
