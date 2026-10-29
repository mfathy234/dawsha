import { api } from './api'
import { acknowledgeAttention } from './attention'
import { patchRuns } from './crewActions'
import { derivePanes, matchAll, primaryTab, sessionIdOf, type PaneView } from './derive'
import { store, type AppState, type PaneState, type TermState } from './state'
import { getTerminal } from './terminals'
import { memberState, stepTrack, visibleState, type AvatarState, type RunTrack } from '../shared/crewLive'
import { sessionState } from '../shared/sessionState'
import type { CrewRun } from '../shared/crew'
import type { CrewRunStatus } from '../shared/cli'

const tracks = new Map<string, RunTrack>()
const RESULT_TAIL_ROWS = 60

const crewTab = (pane: PaneState): TermState | undefined => {
  const primary = primaryTab(pane)
  return primary.crew ? primary : pane.tabs.find((tab) => tab.crew)
}

function observe(view: PaneView, tab: TermState, now: number): RunTrack {
  const runId = tab.crew!.runId
  const next = stepTrack(tracks.get(runId), {
    session: sessionState({ status: view.status, attention: view.attention }),
    tab: tab.status,
    exitCode: tab.exitCode,
    startedAt: tab.startedAt,
    now
  })
  tracks.set(runId, next)
  return next
}

function syncRuns(state: AppState, seen: Map<string, { track: RunTrack; view: PaneView }>, now: number): void {
  const open = state.settings.crewRuns.filter((run) => run.outcome === 'running')
  if (open.length === 0) return
  const changes = new Map<string, Partial<CrewRun>>()
  for (const run of open) {
    const live = seen.get(run.id)
    if (!live) {
      changes.set(run.id, { outcome: 'closed', endedAt: now })
      continue
    }
    const { track, view } = live
    if (track.state === 'done' || track.state === 'failed') {
      changes.set(run.id, {
        outcome: track.state,
        endedAt: track.since,
        costUsd: view.info.costUsd ?? run.costUsd,
        model: view.info.model?.label ?? run.model
      })
    }
  }
  if (changes.size > 0) patchRuns((runs) => runs.map((run) => (changes.has(run.id) ? { ...run, ...changes.get(run.id) } : run)))
}

function evaluate(state: AppState): void {
  if (!state.ready) return
  const hasCrew = state.panes.some((pane) => crewTab(pane) !== undefined)
  if (!hasCrew && Object.keys(state.crewStates).length === 0 && !state.settings.crewRuns.some((run) => run.outcome === 'running')) return
  const now = Date.now()
  const seen = new Map<string, { track: RunTrack; view: PaneView }>()
  const next: Record<string, AvatarState> = {}
  if (hasCrew) {
    for (const view of derivePanes(state)) {
      const tab = crewTab(view.pane)
      if (!tab?.crew) continue
      const track = observe(view, tab, now)
      seen.set(tab.crew.runId, { track, view })
      next[view.pane.id] = visibleState(track, now)
    }
  }
  for (const id of [...tracks.keys()]) if (!seen.has(id)) tracks.delete(id)
  const known = state.crewStates
  const same = Object.keys(next).length === Object.keys(known).length && Object.entries(next).every(([key, value]) => known[key] === value)
  if (!same) store.patch({ crewStates: next })
  syncRuns(state, seen, now)
}

export function installCrewLive(): void {
  store.subscribe(evaluate)
  evaluate(store.state)
}

/** Marks a finished run as seen: its avatar stops showing Done. */
export function acknowledgeRun(runId: string, paneId: string): void {
  const track = tracks.get(runId)
  if (track && track.state === 'done') tracks.set(runId, { ...track, seen: true })
  acknowledgeAttention(paneId)
  evaluate(store.state)
}

export function paneOfRun(runId: string): PaneState | undefined {
  return store.state.panes.find((pane) => pane.tabs.some((tab) => tab.crew?.runId === runId))
}

export function stateOfPane(state: AppState, pane: PaneState): AvatarState {
  return state.crewStates[pane.id] ?? 'idle'
}

export function memberStateNow(state: AppState, memberId: string): AvatarState {
  return memberState(state.panes.filter((pane) => crewTab(pane)?.crew?.memberId === memberId).map((pane) => stateOfPane(state, pane)))
}

export interface LiveRun {
  pane: PaneState
  tab: TermState
  state: AvatarState
}

export function liveRuns(state: AppState): LiveRun[] {
  return state.panes.flatMap((pane) => {
    const tab = crewTab(pane)
    return tab?.crew ? [{ pane, tab, state: stateOfPane(state, pane) }] : []
  })
}

const stateWord = (state: AvatarState): string => (state === 'needs' ? 'needs' : state)

/** Every recorded run, newest first, with the live state where its pane is still open. */
export function crewRunStatuses(state: AppState): CrewRunStatus[] {
  const live = new Map(liveRuns(state).map((run) => [run.tab.crew!.runId, run]))
  return state.settings.crewRuns.map((run) => {
    const found = live.get(run.id)
    return {
      id: run.id,
      member: run.memberName,
      title: run.title,
      state: found ? stateWord(found.state) : run.outcome === 'running' ? 'closed' : run.outcome
    }
  })
}

/** The run's last assistant message when the session record has one, otherwise the tail of its terminal. */
export async function crewRunResult(state: AppState, runId: string): Promise<string | null> {
  const run = state.settings.crewRuns.find((entry) => entry.id === runId)
  if (!run) return null
  const pane = paneOfRun(runId)
  const tab = pane?.tabs.find((entry) => entry.crew?.runId === runId)
  if (!pane || !tab) return `${run.title} was closed, so there is no terminal to read. Resume it from the project's sessions.`
  const sessionId = sessionIdOf(tab, matchAll(state))
  if (sessionId) {
    try {
      const sessions = await api.listAllResumable({ projectId: pane.projectId, agent: tab.agent === 'shell' ? undefined : tab.agent, limit: 30 })
      const text = sessions.find((session) => session.id === sessionId)?.lastAssistant?.trim()
      if (text) return text
    } catch {
      // The terminal tail below is the fallback.
    }
  }
  const tail = getTerminal(tab.id)?.tailText(RESULT_TAIL_ROWS)?.trimEnd() ?? ''
  return tail === '' ? '(no output yet)' : tail
}
