import { stepContextNotice, type ContextNotice } from '../shared/contextWarning'
import { initialAttention, stepAttention, type Attention, type AttentionMemory } from '../shared/attention'
import { detectPermissionPrompt, parsePermissionDetail } from '../shared/permissionPrompt'
import { askingLine, notifyAttribution, replySnippet } from '../shared/notifyContent'
import { api } from './api'
import { focusPaneFromNotification, permissionTail } from './actions'
import { derivePanes, type PaneView } from './derive'
import { store, type AppState } from './state'
import { getTerminal } from './terminals'
import { toast } from './components/toast'
import { boardShowing } from './sessionsLayout'

const PROMPT_POLL_MS = 1500
const PROMPT_TAIL_ROWS = 24
const CLOCK_MS = 15_000

const memories = new Map<string, AttentionMemory>()
const contextMemories = new Map<string, ContextNotice>()

function paneVisible(state: AppState, view: PaneView): boolean {
  if (state.view !== 'grid') return false
  if (boardShowing(state)) return true
  return state.maximizedId === null || state.maximizedId === view.pane.id
}

function notifyText(view: PaneView, kind: 'done' | 'needs'): { title: string; body: string; attribution: string } {
  const attribution = notifyAttribution(view.project?.name, view.agent)
  if (kind === 'needs') {
    const detail = parsePermissionDetail(permissionTail(view.pane.id))
    return { title: `${view.title} needs you`, body: askingLine(detail), attribution }
  }
  const reply = getTerminal(view.primaryTabId)?.prompts.replyText()
  const snippet = reply && !reply.fromScreen ? replySnippet(reply.text) : null
  return { title: `${view.title} is done`, body: snippet ?? 'Finished and waiting for you.', attribution }
}

function notifyContext(state: AppState, view: PaneView): void {
  const key = view.primaryTabId
  const unseen = !state.windowFocused || !paneVisible(state, view)
  const step = stepContextNotice(contextMemories.get(key) ?? { notified: false }, view.info.contextPercent, unseen)
  contextMemories.set(key, step.memory)
  if (!step.notify || !state.settings.sessionInfo.notifications || view.info.contextPercent === null) return
  api.notify({
    paneId: view.pane.id,
    title: `${view.title} context is ${Math.round(view.info.contextPercent)}% full`,
    body: 'Run /compact or start a fresh session.',
    attribution: notifyAttribution(view.project?.name, view.agent),
    sound: state.settings.sessionInfo.sound
  })
}

function evaluate(state: AppState): void {
  const views = derivePanes(state)
  const next: Record<string, Attention> = {}
  for (const view of views) {
    const paneId = view.pane.id
    const step = stepAttention(memories.get(paneId) ?? initialAttention(), {
      status: view.status,
      waiting: view.fileWaiting || state.waiting[paneId] === true,
      focused: (boardShowing(state) ? state.boardPeekId : state.focusedId) === paneId,
      visible: paneVisible(state, view),
      windowFocused: state.windowFocused,
      now: Date.now()
    })
    memories.set(paneId, step.memory)
    notifyContext(state, view)
    next[paneId] = step.memory.attention
    if (step.notify && state.settings.sessionInfo.notifications) {
      api.notify({ paneId, ...notifyText(view, step.notify), sound: state.settings.sessionInfo.sound, flash: step.notify !== 'needs' })
    }
  }
  for (const id of [...memories.keys()]) if (!(id in next)) memories.delete(id)
  const known = state.attention
  const same = Object.keys(next).length === Object.keys(known).length && Object.entries(next).every(([k, v]) => known[k] === v)
  if (!same) store.patch({ attention: next })
}

function pollPrompts(): void {
  const state = store.state
  const waiting: Record<string, boolean> = {}
  for (const view of derivePanes(state)) {
    const tab = view.pane.tabs.find((t) => t.id === view.primaryTabId)
    if (tab?.agent !== 'claude' || tab.status === 'exited') continue
    const tail = getTerminal(tab.id)?.tailText(PROMPT_TAIL_ROWS) ?? ''
    if (detectPermissionPrompt(tail)) waiting[view.pane.id] = true
  }
  const known = state.waiting
  const same = Object.keys(waiting).length === Object.keys(known).length && Object.keys(waiting).every((k) => known[k])
  if (!same) store.patch({ waiting })
}

/** Marks a done session as seen, the same way focusing its pane does, without opening it. */
export function acknowledgeAttention(paneId: string): void {
  const memory = memories.get(paneId)
  if (memory && memory.attention === 'done') memories.set(paneId, { ...memory, attention: 'none' })
  if (store.state.attention[paneId] === 'done') store.patch({ attention: { ...store.state.attention, [paneId]: 'none' } })
}

export function installAttention(): void {
  store.subscribe(evaluate)
  setInterval(pollPrompts, PROMPT_POLL_MS)
  setInterval(() => store.patch({ now: Date.now() }), CLOCK_MS)
  const sync = (): void => store.patch({ windowFocused: document.hasFocus() })
  window.addEventListener('focus', sync)
  window.addEventListener('blur', sync)
  sync()
  api.onNotifyClick((paneId) => {
    if (!store.state.panes.some((pane) => pane.id === paneId)) {
      toast('That session is no longer open.', 'info')
      return
    }
    focusPaneFromNotification(paneId)
  })
}
