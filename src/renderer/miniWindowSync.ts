import { createMiniSnapshotGate, miniSession, miniStateOf, orderMiniSessions, type MiniAction, type MiniSnapshot, type MiniPlanRequest } from '../shared/miniWindow'
import { activeMoment, elapsedSince, stepDoneMemory, type DoneMemory, type MiniLogRead } from '../shared/miniDetail'
import type { MiniWindowSettings } from '../shared/appearance'
import { miniSendRefusal } from '../shared/miniSend'
import { miniStartRefusal, orderMiniProjects, startAgents, type MiniStartOptions } from '../shared/miniStart'
import { detectPermissionPrompt } from '../shared/permissionPrompt'
import { sessionState } from '../shared/sessionState'
import { api } from './api'
import { answerPermission, focusPane, openQuickPick, permissionTail, saveSettings, setSessionInfo, showView, startPromptSession } from './actions'
import { sendChatMessage } from './chat/chatActions'
import { openReviewInFiles } from './files/filesActions'
import { derivePanes, primaryTab } from './derive'
import { sessionNote } from './sessionNotes'
import { store, folderOfPane } from './state'
import { stateSince, timeInState } from './stateClock'
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
  else if (action.kind === 'review') review(action.paneId)
  else if (action.kind === 'send') send(action.paneId, action.text)
  else if (action.kind === 'start') void start(action)
  else if (action.kind === 'answer') {
    // A stale card must never approve a different command that replaced its prompt.
    const tail = permissionTail(action.paneId)
    if (tail.slice(-12000) !== action.prompt || !detectPermissionPrompt(tail) || !answerPermission(action.paneId, action.allow)) {
      toast('That request changed. Open the session to review it.')
    }
  }
}

export function startOptions(): MiniStartOptions {
  const { settings, agents } = store.state
  return {
    projects: orderMiniProjects(settings.projects, settings.recentProjectIds),
    agents: startAgents(agents.report?.tools ?? null)
  }
}

/** Starts a session without moving the main window or its focus. The request is checked here, where the projects live. */
async function start(action: Extract<MiniAction, { kind: 'start' }>): Promise<void> {
  const request = { projectId: action.projectId, agent: action.agent, text: action.text.trim() }
  const refusal = miniStartRefusal(request, startOptions())
  if (refusal) { toast(refusal); return }
  const paneId = await startPromptSession(request.projectId, request.agent, request.text)
  if (!paneId) { toast('Could not start that session.'); return }
  const recent = [request.projectId, ...store.state.settings.recentProjectIds.filter(id => id !== request.projectId)].slice(0, 5)
  store.patch({ settings: { ...store.state.settings, recentProjectIds: recent } })
  void saveSettings({ recentProjectIds: recent })
}

function review(paneId: string): void {
  const pane = store.state.panes.find(candidate => candidate.id === paneId)
  const folder = pane ? folderOfPane(store.state, pane) : null
  if (pane && folder) openReviewInFiles({ projectId: pane.projectId, folder })
  else toast('That session is gone.')
}

/** The same send path as the chat box, refused for shells and when the session is gone, has exited, shows a menu or waits for an answer. */
function send(paneId: string, text: string): void {
  const view = derivePanes(store.state).find(candidate => candidate.pane.id === paneId)
  const tab = view ? primaryTab(view.pane) : null
  if (!view || !tab) { toast('That session is gone.'); return }
  const refusal = miniSendRefusal({ agent: tab.agent, status: tab.status, tail: permissionTail(paneId) })
  if (refusal) { toast(refusal); return }
  // A prompt can appear between typing and the delayed Enter; that Enter would approve it.
  sendChatMessage(tab.id, tab.agent, text, () => {
    const late = miniSendRefusal({ agent: tab.agent, status: tab.status, tail: permissionTail(paneId) })
    if (late) toast(late)
    return !late
  })
}

/** A single bounded publisher, including plans for sessions whose Chat view is not on screen. */
export function installMiniWindowSync(): void {
  let gate = createMiniSnapshotGate()
  let logs: Record<string, MiniLogRead> = {}
  const done = new Map<string, DoneMemory>()
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
      const shape = { status: view.status, attention: view.attention, tail }
      const since = stateSince(id, sessionState(view), state.now)
      const memory = stepDoneMemory(done.get(id), miniStateOf(shape).state, state.now)
      done.set(id, memory)
      const log = logs[id]
      return miniSession({
        paneId: id, agent: view.agent, identity: view.crew?.identity, title: view.title,
        project: view.project?.name ?? '', status: view.status, attention: view.attention,
        tail, recap: note.recap, tool: note.tool, idleFor: timeInState(id, sessionState(view), state.now),
        changed: view.info.changes?.files ?? null, todos: log?.todos ?? [],
        elapsed: elapsedSince(since, state.now), asked: log?.asked ?? '', reply: log?.reply ?? [],
        changes: view.info.changes, context: view.info.contextPercent, costUsd: view.info.costUsd,
        moment: activeMoment(memory, state.now),
        plan: view.snapshot?.plan ? { ...view.snapshot.plan, current: view.snapshot.plan.title ?? '' }
          : planNote ? { done: Number(planNote[1]), total: Number(planNote[2]), current: note.planNow } : null
      })
    })
    for (const id of done.keys()) if (!views.some(view => view.pane.id === id)) done.delete(id)
    if (visible && !reading && Date.now() - planReadAt >= 1000) {
      reading = true
      planReadAt = Date.now()
      const current = generation
      void api.miniWindow.plans(requests).then(result => { if (visible && current === generation) logs = result })
        .catch(() => undefined).finally(() => { reading = false })
    }
    const root = document.documentElement
    const key = JSON.stringify([state.settings.theme, state.settings.appearance, root.style.cssText, root.dataset.kind])
    if (key !== themeKey) {
      themeKey = key
      const css = getComputedStyle(root)
      theme = Object.fromEntries(Array.from(css).filter(name => name.startsWith('--')).map(name => [name, css.getPropertyValue(name).trim()]))
    }
    const snapshot: MiniSnapshot = { sessions: orderMiniSessions(sessions), folded: state.settings.miniWindow.folded, sound: state.settings.sessionInfo.sound, start: startOptions(), theme, kind: root.dataset.kind ?? 'dark' }
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
