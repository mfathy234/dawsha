import { composerHolds, submitDelayFor, submitKey } from '../../shared/chatSubmit'
import { detectTerminalMenu } from '../../shared/terminalMenu'
import type { TabAgent } from '../../shared/types'
import { chatViewKey, defaultViewFor, rememberChatView, resolveChatView, type ChatAgent, type ChatView } from '../../shared/chatLog'
import { persistWorkspace, saveSettings } from '../actions'
import { api } from '../api'
import type { PaneView } from '../derive'
import { mapTerm, store, type TermState } from '../state'
import { getTerminal } from '../terminals'
import { sessionIdOf } from '../transcriptActions'


export const primaryTab = (view: PaneView): TermState | undefined => view.pane.tabs.find((tab) => tab.id === view.primaryTabId)

export function sessionKey(tab: TermState): string | null {
  const id = sessionIdOf(tab)
  return id ? chatViewKey(tab.agent, id) : null
}

/** The view a pane's agent session is in: its own choice, what it remembered, or the default from Settings. */
export function paneViewOf(view: PaneView): ChatView {
  const tab = primaryTab(view)
  if (!tab) return 'terminal'
  const key = sessionKey(tab)
  const { sessionViews, chatViews } = store.state.settings
  return resolveChatView({ agent: tab.agent, tabView: tab.view, remembered: key ? chatViews[key] : undefined, fallback: defaultViewFor(sessionViews, tab.agent) })
}

function remember(key: string, next: ChatView): void {
  const chatViews = rememberChatView(store.state.settings.chatViews, key, next)
  store.set((state) => ({ ...state, settings: { ...state.settings, chatViews } }))
  void saveSettings({ chatViews })
}

export function setPaneView(paneId: string, next: ChatView): void {
  const view = store.state.panes.find((pane) => pane.id === paneId)
  const tab = view?.tabs.find((candidate) => candidate.agent !== 'shell')
  if (!tab) return
  store.set((state) => mapTerm(state, tab.id, (current) => ({ ...current, view: next })))
  persistWorkspace()
  const key = sessionKey(tab)
  if (key) remember(key, next)
}

/** A session whose id was unknown when its view was chosen (a new Claude session) is remembered once the id is known. */
export function rememberPending(view: PaneView): void {
  const tab = primaryTab(view)
  if (!tab?.view) return
  const key = sessionKey(tab)
  if (key && store.state.settings.chatViews[key] !== tab.view) remember(key, tab.view)
}

export function setDefaultView(agent: ChatAgent, next: ChatView): void {
  const sessionViews = { ...store.state.settings.sessionViews, [agent]: next }
  store.set((state) => ({ ...state, settings: { ...state.settings, sessionViews } }))
  void saveSettings({ sessionViews })
}

/** Types a message into the agent's terminal and presses Enter, the same as typing it there. */
export function sendChatMessage(tabId: string, agent: TabAgent, text: string): { flattened: boolean } {
  const terminal = getTerminal(tabId)
  if (!terminal || text.trim() === '') return { flattened: false }
  const { flattened } = terminal.insertText(text.trim())
  // Mark the prompt as typing Enter would, so Ctrl+Up and Copy last reply point at this message.
  terminal.prompts.noteInput('\r')
  window.setTimeout(() => {
    api.write(tabId, '\r')
    if (agent === 'codex') confirmSent(tabId, text.trim(), 1)
  }, submitDelayFor(agent))
  return { flattened }
}

const CHECK_MS = 1_200
const MAX_PRESSES = 3
const MAX_CHECKS = 50
const SCREEN_ROWS = 30

/**
 * Codex can leave a message in its box after Enter, and the next message is then glued onto it. Watch the box until it
 * is empty: while Codex says it is holding the message until it has started, just wait; otherwise press the key Codex
 * asks for (Tab to queue while it works, Enter when idle), a few times at most and never while a menu is up.
 */
function confirmSent(tabId: string, message: string, presses: number, checks = 0): void {
  window.setTimeout(() => {
    const tail = getTerminal(tabId)?.tailText(SCREEN_ROWS) ?? ''
    if (tail === '' || detectTerminalMenu(tail) || !composerHolds(tail, message)) return
    const key = submitKey(tail)
    if (key) api.write(tabId, key)
    const pressed = presses + (key ? 1 : 0)
    if (pressed <= MAX_PRESSES && checks < MAX_CHECKS) confirmSent(tabId, message, pressed, checks + 1)
  }, CHECK_MS)
}

export function interruptAgent(tabId: string): void {
  api.write(tabId, '\x1b')
}
