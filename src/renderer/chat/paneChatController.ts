import { chatCapable } from '../../shared/chatLog'
import type { SessionState } from '../../shared/sessionState'
import type { AgentKind } from '../../shared/types'
import { api } from '../api'
import { folderOfPane, store } from '../state'
import { continueIn } from '../handoffActions'
import type { PaneView } from '../derive'
import { timeInState } from '../stateClock'
import { getTerminal } from '../terminals'
import { openReviewInFiles } from '../files/filesActions'
import { sessionIdOf } from '../transcriptActions'
import { answerMenu } from './menuActions'
import { interruptAgent, paneViewOf, primaryTab, rememberPending, sendChatMessage, setPaneView } from './chatActions'
import type { ChatHost, PaneChat } from './paneChat'
import type { ViewSwitch } from './viewSwitch'

const MENU_ROWS = 28

/** What a pane's chat does to the rest of the app: type into the terminal, switch views, hand off to the other agent. */
export function chatHostFor(paneId: string, current: () => PaneView | null): ChatHost {
  const tabId = (): string => current()?.primaryTabId ?? ''
  return {
    showTerminal: () => setPaneView(paneId, 'terminal'),
    continueIn: (to: AgentKind, message?: string | null) => void continueIn(paneId, to, message),
    send: (text) => sendChatMessage(tabId(), current()?.agent ?? 'shell', text),
    interrupt: () => interruptAgent(tabId()),
    screenTail: () => getTerminal(tabId())?.tailText(MENU_ROWS) ?? '',
    answer: (steps) => void answerMenu(tabId(), steps),
    notify: (title, body) => api.notify({ paneId, title, body, sound: store.state.settings.sessionInfo.sound }),
    reviewChanges: () => {
      const pane = store.state.panes.find((candidate) => candidate.id === paneId)
      const folder = pane ? folderOfPane(store.state, pane) : null
      if (pane && folder) openReviewInFiles({ projectId: pane.projectId, folder })
    }
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
          exited: tab.status === 'exited',
          status: tab.status,
          startedAt: tab.startedAt,
          elapsed: state === 'working' ? timeInState(paneId, state, view.now) : '',
          tabId: tab.id,
          title: view.title,
          model: view.info.model?.label ?? null,
          contextPercent: view.info.contextPercent,
          contextTokens: view.info.contextTokens,
          contextWindow: view.info.contextWindow
        }
      : null
  )
  return shown
}
