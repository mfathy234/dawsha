import { AGENT_NAMES } from '../shared/agents'
import { buildHandoff, buildTranscriptHandoff, type HandoffCheck } from '../shared/handoff'
import { DEFAULT_FONT_SIZE, clampFontSize, type AgentKind } from '../shared/types'
import { launch, makeTerm, persistWorkspace, refreshBranches, refreshGitChanges } from './actions'
import { api } from './api'
import { handoffDialog } from './components/handoffDialog'
import { toast } from './components/toast'
import { derivePanes, type PaneView } from './derive'
import { folderOfPane, newId, paneById, store, type PaneState } from './state'
import { getTerminal } from './terminals'
import { sessionIdOf } from './transcriptActions'

function lastCheck(view: PaneView): HandoffCheck | null {
  const checks = view.snapshot?.checks ?? []
  const newest = [...checks].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0]
  return newest ? { kind: newest.kind, ok: newest.ok, summary: newest.summary } : null
}

export function sourceAgent(paneId: string): AgentKind | null {
  const view = derivePanes(store.state).find((v) => v.pane.id === paneId)
  return view && view.agent !== 'shell' ? view.agent : null
}

export interface HandoffSummary {
  text: string
  from: AgentKind
  transcriptPath: string | null
}

async function savedTranscript(view: PaneView, agent: AgentKind): Promise<string | null> {
  const tab = view.pane.tabs.find((t) => t.id === view.pane.activeTabId) ?? view.pane.tabs[0]
  const sessionId = tab ? sessionIdOf(tab) : undefined
  if (!sessionId || !view.project) return null
  const result = await api.writeHandoffTranscript({ projectId: view.project.id, agent, sessionId })
  return result.status === 'saved' ? result.path : null
}

export async function summaryFor(paneId: string): Promise<HandoffSummary | null> {
  const state = store.state
  const view = derivePanes(state).find((v) => v.pane.id === paneId)
  if (!view || !view.project || view.agent === 'shell') return null
  const folder = folderOfPane(state, view.pane) ?? view.project.folder
  const files = (await api.gitFiles(folder)) ?? view.snapshot?.files.map((file) => file.path) ?? []
  const output = getTerminal(view.primaryTabId)?.tailText(120) ?? ''
  const input = {
    from: view.agent,
    projectName: view.project.name,
    title: view.named ? view.title : null,
    files,
    plan: view.snapshot?.plan ?? null,
    check: lastCheck(view),
    output
  }
  const transcriptPath = await savedTranscript(view, view.agent)
  const text = transcriptPath ? buildTranscriptHandoff({ ...input, transcriptPath }) : buildHandoff(input)
  return { text, from: view.agent, transcriptPath }
}

export async function startHandoff(paneId: string, to: AgentKind, text: string, from: AgentKind): Promise<void> {
  const state = store.state
  const source = paneById(state, paneId)
  const project = source ? state.settings.projects.find((p) => p.id === source.projectId) : undefined
  if (!source || !project) {
    toast('The pane to continue from is gone.')
    return
  }
  const tab = { ...makeTerm(to, []), prompt: text, from }
  const pane: PaneState = {
    id: newId(),
    projectId: project.id,
    tabs: [tab],
    activeTabId: tab.id,
    fontSize: clampFontSize(project.fontSize ?? DEFAULT_FONT_SIZE),
    folder: source.folder
  }
  store.set((s) => ({
    ...s,
    panes: [...s.panes, pane],
    focusedId: pane.id,
    maximizedId: s.maximizedId ? pane.id : null,
    detailsPaneId: null,
    view: 'grid',
    sidebarOverride: null
  }))
  persistWorkspace()
  void refreshBranches()
  void refreshGitChanges()
  void launch(pane.id, tab.id, false)
}

export async function continueIn(paneId: string, to: AgentKind): Promise<void> {
  const summary = await summaryFor(paneId)
  if (!summary) {
    toast('Only a pane with an agent session can be continued in another agent.', 'info')
    return
  }
  const text = await handoffDialog({ from: summary.from, to, text: summary.text, transcriptPath: summary.transcriptPath })
  if (text === null) return
  await startHandoff(paneId, to, text, summary.from)
}

export const continueLabel = (to: AgentKind): string => `Continue in ${AGENT_NAMES[to]}`
