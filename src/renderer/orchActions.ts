import type { OrchArchiveFileResult, OrchExportFormat, OrchResult } from '../shared/orch/api'
import type { OrchDecisionView, OrchPaneRequest, OrchSnapshot, OrchStartInput } from '../shared/orch/api'
import type { OrchProfile } from '../shared/orch/profiles'
import { DEFAULT_FONT_SIZE, clampFontSize } from '../shared/types'
import { discardPane, launch, makeTerm, persistWorkspace, saveSettings } from './actions'
import { api } from './api'
import { choiceDialog, confirmDialog, promptDialog } from './components/dialogs'
import { toast } from './components/toast'
import { newId, projectById, store, type OrchTab, type PaneState, type TermState } from './state'
import { runTitleFrom } from '../shared/orch/runTitle'

// Orchestrator in the renderer: panes the main process asks for, and the phase 2 start and answer commands.

/** Opens a pane for an orchestrator agent without taking focus from what the user is doing. */
export function openOrchPane(request: OrchPaneRequest): void {
  const project = request.projectId ? projectById(store.state, request.projectId) : undefined
  if (!project) {
    toast('The orchestrator tried to open an agent for a project that is no longer in Dawsha.')
    return
  }
  const tab: TermState = {
    ...makeTerm(request.runner, [], request.sessionId ?? undefined, request.title),
    titleHint: request.title,
    prompt: request.prompt,
    orchAgentId: request.agentId
  }
  const pane: PaneState = {
    id: newId(),
    projectId: project.id,
    tabs: [tab],
    activeTabId: tab.id,
    fontSize: clampFontSize(project.fontSize ?? DEFAULT_FONT_SIZE),
    folder: request.folder
  }
  store.set((s) => ({ ...s, panes: [...s.panes, pane], focusedId: s.focusedId ?? pane.id }))
  persistWorkspace()
  void launch(pane.id, tab.id, false)
}

/** Closes the pane of an agent the orchestrator replaced (for example after a handoff). */
export function closeOrchPane(agentId: string): void {
  const pane = store.state.panes.find((p) => p.tabs.some((t) => t.orchAgentId === agentId))
  if (pane) void discardPane(pane.id)
}

/** Fetches the orchestrator state again; called on start and whenever the main process says it changed. */
export async function refreshOrch(): Promise<void> {
  if (!store.state.settings.experimental.orchestrator) {
    if (store.state.orch) store.patch({ orch: null })
    return
  }
  try {
    const orch = await api.orchSnapshot()
    notifyNewDecisions(orch)
    store.patch({ orch })
    closeRetiredAgentPanes(orch)
  } catch {
    // The next change notification tries again.
  }
}

/** A pane whose agent is done (task finished, run finished or cancelled) has nothing left to do: close it. */
function closeRetiredAgentPanes(orch: OrchSnapshot): void {
  const retired = new Set(orch.runs.flatMap((run) => run.agents.filter((a) => a.retired).map((a) => a.id)))
  for (const pane of store.state.panes) {
    if (pane.tabs.some((t) => t.orchAgentId && retired.has(t.orchAgentId))) void discardPane(pane.id)
  }
}

/** Notification ids for orchestrator decisions; clicking one opens Human review. */
export const ORCH_NOTIFY_PREFIX = 'orch:'
let seenDecisions: Set<string> | null = null

/** A Windows notification for each question that arrived since the last snapshot (not for old ones at start). */
function notifyNewDecisions(orch: OrchSnapshot): void {
  const ids = new Set(orch.decisions.map((d) => d.id))
  const fresh = seenDecisions ? orch.decisions.filter((d) => !seenDecisions?.has(d.id)) : []
  seenDecisions = ids
  const { notifications, sound } = store.state.settings.sessionInfo
  if (!notifications) return
  for (const decision of fresh) {
    api.notify({
      paneId: `${ORCH_NOTIFY_PREFIX}${decision.id}`,
      title: `Orchestrator · ${decision.runTitle || 'Needs you'}`,
      body: decision.question.slice(0, 180),
      sound
    })
  }
}

/** Opens the Orchestrator view on a tab, or on one run's dashboard. */
export function showOrch(tab: OrchTab, runId: string | null = null): void {
  store.patch({ view: 'orchestrator', orchTab: tab, orchRunId: runId })
}

export async function answerDecision(decisionId: string, answer: string): Promise<boolean> {
  const result = await api.orchAnswer(decisionId, answer)
  if (!result.ok) toast(result.error)
  void refreshOrch()
  return result.ok
}

export async function handoffTask(runId: string, taskKey: string, profileId: string, note: string): Promise<boolean> {
  const result = await api.orchHandoff({ runId, taskKey, profileId, note })
  toast(result.ok ? `${taskKey} continues on the new model in a new pane.` : result.error, result.ok ? 'info' : 'error')
  void refreshOrch()
  return result.ok
}

export async function restartAgent(runId: string, agentId: string, label: string): Promise<void> {
  if (!await confirmDialog({ title: `Restart ${label}?`, body: 'A fresh agent continues in the same worktree. Its current pane closes.', confirmLabel: 'Restart', danger: false })) return
  const result = await api.orchRestart(runId, agentId)
  if (!result.ok) toast(result.error)
  void refreshOrch()
}

export async function cancelRun(runId: string, title: string): Promise<void> {
  const confirmed = await confirmDialog({
    title: `Cancel "${title}"?`,
    body: 'Its agents stop and their panes close. The worktrees and branches stay on disk.',
    confirmLabel: `Cancel "${title.slice(0, 40)}"`,
    cancelLabel: 'Keep running',
    danger: true
  })
  if (!confirmed) return
  const result = await api.orchCancelRun(runId)
  if (!result.ok) toast(result.error)
  void refreshOrch()
}

export async function startRun(input: OrchStartInput): Promise<boolean> {
  const result = await api.orchStartRun(input)
  if (!result.ok) {
    toast(result.error)
    return false
  }
  toast(input.kind === 'bug' ? 'Bug fix started. Its agent opens in a new pane.' : 'Feature run started. The spec writer opens in a new pane.', 'info')
  await refreshOrch()
  showOrch('runs', result.value)
  return true
}

export function setOrchestratorAutoTrust(autoTrust: boolean): void {
  const orchestrator = { ...store.state.settings.orchestrator, autoTrust }
  store.set((s) => ({ ...s, settings: { ...s.settings, orchestrator } }))
  void saveSettings({ orchestrator })
}

function currentProjectId(): string | null {
  const { panes, focusedId, settings } = store.state
  return panes.find((p) => p.id === focusedId)?.projectId ?? settings.projects[0]?.id ?? null
}

const MAIN_MODEL = '\u0000main'

const profileLabel = (p: OrchProfile): string => `${p.name} · ${p.runner}${p.model ? ` ${p.model}` : ''}${p.effort ? ` · ${p.effort}` : ''}`

/** Profiles worth offering for a bug fix: one per runner, model and effort. */
function fixerChoices(): { label: string; value: string | null }[] {
  const { orchestrator } = store.state.settings
  const plan = orchestrator.plans.find((p) => p.id === orchestrator.defaultPlanId)
  const lead = orchestrator.profiles.find((p) => p.id === plan?.roles.lead)
  const seen = new Set<string>()
  const others = orchestrator.profiles.filter((p) => {
    const key = `${p.runner}|${p.model}|${p.effort}|${p.local}`
    if (p.id === lead?.id || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [
    { label: lead ? `Main model (${profileLabel(lead)})` : 'Main model', value: null },
    ...others.slice(0, 5).map((p) => ({ label: profileLabel(p), value: p.id }))
  ]
}

export async function startBugRun(): Promise<void> {
  const projectId = currentProjectId()
  if (!projectId) return toast('Add a project first.', 'info')
  const story = await promptDialog({
    title: 'Fix a bug',
    label: 'What is wrong?',
    hint: 'One agent fixes it on its own, in a new worktree. No other agents run.',
    confirmLabel: 'Next',
    validate: (value) => (value.trim() ? null : 'Describe the bug.')
  })
  if (!story) return
  // choiceDialog returns null on Cancel, so the main model needs its own value.
  const picked = await choiceDialog<string>({
    title: 'Which model fixes it?',
    body: "The plan's main model is the default.",
    choices: fixerChoices().map((c, i) => ({ label: c.label, value: c.value ?? MAIN_MODEL, kind: i === 0 ? 'primary' : 'ghost' }))
  })
  if (!picked) return
  const fixerProfileId = picked === MAIN_MODEL ? null : picked
  const result = await api.orchStartRun({
    kind: 'bug',
    projectId,
    title: runTitleFrom(story),
    story,
    planId: store.state.settings.orchestrator.defaultPlanId,
    fixerProfileId
  })
  toast(result.ok ? 'Bug fix started. Its agent opens in a new pane.' : result.error, result.ok ? 'info' : undefined)
}

export async function startFeatureRun(): Promise<void> {
  const projectId = currentProjectId()
  if (!projectId) return toast('Add a project first.', 'info')
  const story = await promptDialog({
    title: 'Build a feature',
    label: 'User story',
    hint: 'A spec writer turns it into a spec and mockups first. You approve them before anything is built.',
    confirmLabel: 'Next',
    validate: (value) => (value.trim() ? null : 'Write the user story.')
  })
  if (!story) return
  const { orchestrator } = store.state.settings
  const planId = await choiceDialog<string>({
    title: 'Which plan?',
    body: 'Plans are edited in Settings.',
    choices: orchestrator.plans.map((p) => ({ label: p.name, value: p.id, kind: p.id === orchestrator.defaultPlanId ? 'primary' : 'ghost' }))
  })
  if (!planId) return
  const result = await api.orchStartRun({ kind: 'feature', projectId, title: runTitleFrom(story), story, planId, fixerProfileId: null })
  toast(result.ok ? 'Feature run started. The spec writer opens in a new pane.' : result.error, result.ok ? 'info' : undefined)
}

const OTHER = '\u0000other'

async function answerOne(decision: OrchDecisionView): Promise<boolean> {
  const choice = await choiceDialog<string>({
    title: decision.runTitle || 'Orchestrator',
    body: decision.context && decision.context !== decision.question ? `${decision.question}\n\n${decision.context}` : decision.question,
    choices: [...decision.options.map((o, i) => ({ label: o, value: o, kind: i === 0 ? ('primary' as const) : ('ghost' as const) })), { label: 'Other answer…', value: OTHER }]
  })
  if (!choice) return false
  const answer = choice === OTHER
    ? await promptDialog({ title: 'Your answer', label: decision.question, confirmLabel: 'Send', validate: (v) => (v.trim() ? null : 'Write an answer.') })
    : choice
  if (!answer) return false
  const result = await api.orchAnswer(decision.id, answer)
  if (!result.ok) toast(result.error)
  return result.ok
}

/** Answers waiting questions one by one, oldest first. */
export async function answerDecisions(): Promise<void> {
  const decisions = await api.orchDecisions()
  if (decisions.length === 0) return toast('Nothing is waiting for you.', 'info')
  for (const decision of decisions) {
    if (!(await answerOne(decision))) return
  }
}

/** File errors are always surfaced; path selection stays in main. */
async function historyFiles(action: () => Promise<OrchResult<OrchArchiveFileResult[]>>, verb: string): Promise<void> {
  try {
    const result = await action()
    if (!result.ok) { toast(result.error); return }
    for (const file of result.value) if (!file.result.ok) toast(`${file.path}: ${file.result.error}`)
    const count = result.value.filter((file) => file.result.ok).length
    if (count) toast(`${verb} ${count} ${count === 1 ? 'run' : 'runs'}.`, 'info')
    await refreshOrch()
  } catch { toast('Could not process the selected runs.') }
}

export async function exportHistoryRun(id: string, format: OrchExportFormat): Promise<void> {
  try {
    const result = await api.orchExportRun(id, format)
    if (!result.ok) toast(result.error)
    else if (result.value) toast('Run exported.', 'info')
  } catch { toast('Could not export the run.') }
}

export async function exportHistoryRuns(ids: string[]): Promise<void> {
  await historyFiles(() => api.orchExportRuns(ids), 'Exported')
}

export async function importHistoryRuns(): Promise<void> {
  await historyFiles(() => api.orchImportRuns(), 'Imported')
}
