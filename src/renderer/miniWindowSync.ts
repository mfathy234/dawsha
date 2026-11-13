import { createMiniSnapshotGate, miniSession, orderMiniSessions, type MiniAction, type MiniSnapshot, type MiniPlanRequest } from '../shared/miniWindow'
import type { MiniWindowSettings } from '../shared/appearance'
import type { TodoEntry } from '../shared/chatCards'
import { detectPermissionPrompt } from '../shared/permissionPrompt'
import { sessionState } from '../shared/sessionState'
import { api } from './api'
import { answerPermission, focusPane, openQuickPick, permissionTail, saveSettings, setSessionInfo, showView } from './actions'
import { derivePanes, primaryTab } from './derive'
import { sessionNote } from './sessionNotes'
import { store, folderOfPane } from './state'
import { timeInState } from './stateClock'
import { sessionIdOf } from './transcriptActions'
import { toast } from './components/toast'

export function setMiniWindow(patch: Partial<MiniWindowSettings>): void {
  const miniWindow = { ...store.state.settings.miniWindow, ...patch }
  store.patch({ settings: { ...store.state.settings, miniWindow } })
  void saveSettings({ miniWindow })
}

export const toggleMiniWindow = (): void => api.miniWindow.toggle()

function act(action: MiniAction): void {
  if (action.kind === 'fold') setMiniWindow({ folded: !store.state.settings.miniWindow.folded })
  else if (action.kind === 'sound') setSessionInfo({ sound: !store.state.settings.sessionInfo.sound })
  else if (action.kind === 'new') { showView('grid'); openQuickPick() }
  else if (action.kind === 'open') { showView('grid'); focusPane(action.paneId) }
  else if (action.kind === 'answer') {
    // A stale card must never approve a different command that replaced its prompt.
    const tail = permissionTail(action.paneId)
    if (tail.slice(-12000) !== action.prompt || !detectPermissionPrompt(tail) || !answerPermission(action.paneId, action.allow)) {
      toast('That request changed. Open the session to review it.')
    }
  }
}

/** A single bounded publisher, including plans for sessions whose Chat view is not on screen. */
export function installMiniWindowSync(): void {
  let gate = createMiniSnapshotGate()
  let todos: Record<string, readonly TodoEntry[]> = {}
  let reading = false
  let planReadAt = -Infinity
  let generation = 0
  let visible = false
  let themeKey = ''
  let theme: Record<string, string> = {}
  const tick = (): void => {
    const state = store.state
    // Nothing to do while the Mini window is closed, so Classic pays nothing for it.
    if (!state.ready || !visible) return
    const views = derivePanes(state)
    const requests: MiniPlanRequest[] = []
    const sessions = views.map(view => {
      const id = view.pane.id
      const tab = primaryTab(view.pane)
      const sessionId = sessionIdOf(tab)
      const folder = folderOfPane(state, view.pane)
      if (visible && sessionId && folder && (view.agent === 'claude' || view.agent === 'codex')) {
        requests.push({ paneId: id, agent: view.agent, sessionId, folder })
      }
      const note = sessionNote(id)
      const tail = permissionTail(id)
      const planNote = /^(\d+) of (\d+)$/.exec(note.plan)
      return miniSession({
        paneId: id, agent: view.agent, identity: view.crew?.identity, title: view.title,
        project: view.project?.name ?? '', status: view.status, attention: view.attention,
        tail, recap: note.recap, tool: note.tool, idleFor: timeInState(id, sessionState(view), state.now),
        changed: view.info.changes?.files ?? null, todos: todos[id] ?? [],
        plan: view.snapshot?.plan ? { ...view.snapshot.plan, current: view.snapshot.plan.title ?? '' }
          : planNote ? { done: Number(planNote[1]), total: Number(planNote[2]), current: '' } : null
      })
    })
    if (visible && !reading && Date.now() - planReadAt >= 1000) {
      reading = true
      planReadAt = Date.now()
      const current = generation
      void api.miniWindow.plans(requests).then(result => { if (visible && current === generation) todos = result })
        .catch(() => undefined).finally(() => { reading = false })
    }
    const root = document.documentElement
    const key = JSON.stringify([state.settings.theme, state.settings.appearance, root.style.cssText, root.dataset.kind])
    if (key !== themeKey) {
      themeKey = key
      const css = getComputedStyle(root)
      theme = Object.fromEntries(Array.from(css).filter(name => name.startsWith('--')).map(name => [name, css.getPropertyValue(name).trim()]))
    }
    const snapshot: MiniSnapshot = { sessions: orderMiniSessions(sessions), folded: state.settings.miniWindow.folded, sound: state.settings.sessionInfo.sound, theme, kind: root.dataset.kind ?? 'dark' }
    if (gate.take(snapshot, Date.now())) api.miniWindow.publish(snapshot)
  }
  api.miniWindow.onAction(act)
  api.miniWindow.onVisibility(value => {
    visible = value
    generation += 1
    planReadAt = -Infinity
    if (value) gate = createMiniSnapshotGate()
    tick()
  })
  api.miniWindow.onBounds(bounds => store.patch({ settings: { ...store.state.settings, miniWindow: { ...store.state.settings.miniWindow, bounds } } }))
  window.setInterval(tick, 250)
  tick()
}
