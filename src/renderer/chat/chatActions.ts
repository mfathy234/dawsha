import { chatViewKey, rememberChatView, resolveChatView, type ChatView } from '../../shared/chatLog'
import { persistWorkspace, saveSettings } from '../actions'
import { api } from '../api'
import type { PaneView } from '../derive'
import { mapTerm, store, type TermState } from '../state'
import { getTerminal } from '../terminals'
import { sessionIdOf } from '../transcriptActions'

const SUBMIT_DELAY_MS = 40

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
  const { sessionView, chatViews } = store.state.settings
  return resolveChatView({ agent: tab.agent, tabView: tab.view, remembered: key ? chatViews[key] : undefined, fallback: sessionView })
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

export function setDefaultView(next: ChatView): void {
  store.set((state) => ({ ...state, settings: { ...state.settings, sessionView: next } }))
  void saveSettings({ sessionView: next })
}

/** Types a message into the agent's terminal and presses Enter, the same as typing it there. */
export function sendChatMessage(tabId: string, text: string): void {
  const terminal = getTerminal(tabId)
  if (!terminal || text.trim() === '') return
  terminal.insertText(text.trim())
  window.setTimeout(() => api.write(tabId, '\r'), SUBMIT_DELAY_MS)
}

export function interruptAgent(tabId: string): void {
  api.write(tabId, '\x1b')
}
