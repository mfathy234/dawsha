import type { OrchDecisionView, OrchPaneRequest } from '../shared/orch/api'
import type { OrchProfile } from '../shared/orch/profiles'
import { DEFAULT_FONT_SIZE, clampFontSize } from '../shared/types'
import { discardPane, launch, makeTerm, persistWorkspace, saveSettings } from './actions'
import { api } from './api'
import { choiceDialog, promptDialog } from './components/dialogs'
import { toast } from './components/toast'
import { newId, projectById, store, type PaneState, type TermState } from './state'

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

export function setOrchestratorEnabled(enabled: boolean): void {
  const experimental = { ...store.state.settings.experimental, orchestrator: enabled }
  store.set((s) => ({ ...s, settings: { ...s.settings, experimental } }))
  void saveSettings({ experimental })
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
    title: story.slice(0, 80),
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
  const result = await api.orchStartRun({ kind: 'feature', projectId, title: story.slice(0, 80), story, planId, fixerProfileId: null })
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
