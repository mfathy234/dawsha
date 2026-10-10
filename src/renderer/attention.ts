import { stepContextNotice, type ContextNotice } from '../shared/contextWarning'
import { initialAttention, stepAttention, type Attention, type AttentionMemory } from '../shared/attention'
import { detectPermissionPrompt } from '../shared/permissionPrompt'
import { api } from './api'
import { focusPane } from './actions'
import { derivePanes, type PaneView } from './derive'
import { store, type AppState } from './state'
import { getTerminal } from './terminals'

const PROMPT_POLL_MS = 1500
const PROMPT_TAIL_ROWS = 24
const CLOCK_MS = 15_000

const memories = new Map<string, AttentionMemory>()
const contextMemories = new Map<string, ContextNotice>()

function paneVisible(state: AppState, view: PaneView): boolean {
  if (state.view !== 'grid') return false
  return state.maximizedId === null || state.maximizedId === view.pane.id
}

function notifyText(view: PaneView, kind: 'done' | 'needs'): { title: string; body: string } {
  const project = view.project?.name ?? 'Dawsha'
  return kind === 'done'
    ? { title: `${view.title} is done`, body: `${project}: the session finished and is waiting for you.` }
    : { title: `${view.title} needs you`, body: `${project}: the session is waiting on a permission prompt.` }
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
    body: `${view.project?.name ?? 'Dawsha'}: /compact or start a fresh session.`,
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
      focused: state.focusedId === paneId,
      visible: paneVisible(state, view),
      windowFocused: state.windowFocused
    })
    memories.set(paneId, step.memory)
    notifyContext(state, view)
    next[paneId] = step.memory.attention
    if (step.notify && state.settings.sessionInfo.notifications) {
      api.notify({ paneId, ...notifyText(view, step.notify), sound: state.settings.sessionInfo.sound })
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

export function installAttention(): void {
  store.subscribe(evaluate)
  setInterval(pollPrompts, PROMPT_POLL_MS)
  setInterval(() => store.patch({ now: Date.now() }), CLOCK_MS)
  const sync = (): void => store.patch({ windowFocused: document.hasFocus() })
  window.addEventListener('focus', sync)
  window.addEventListener('blur', sync)
  sync()
  api.onNotifyClick((paneId) => focusPane(paneId))
}
