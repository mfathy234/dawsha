import { shortId } from '../shared/compare'
import { identityOf, resolveRun, type CrewRun, type RunChoice } from '../shared/crew'
import { composeInstructions, crewFullAccess } from '../shared/crewLaunch'
import {
  addNote,
  answerQuestion,
  askQuestion,
  buildLeadMessage,
  decidePlan,
  emptyLive,
  goalSpent,
  goalTitle,
  leadMembers,
  proposePlan,
  MAX_GOALS,
  type CrewGoal,
  type GoalLive,
  type LeadPlan,
  type LeadSettings
} from '../shared/crewLead'
import type { LeadGoalInfo, LeadHost, PlanDecision } from '../shared/cli'
import { saveSettings, startCrewSession } from './actions'
import { currentMembers, patchRuns } from './crewActions'
import { crewRunStatuses, paneOfRun } from './crewLive'
import { projectById, store } from './state'

const LEAD_ALLOW = 'Bash(dawsha crew:*)'

const planWaiters = new Map<string, (decision: PlanDecision) => void>()
const askWaiters = new Map<string, { id: string; resolve: (answer: { ok: true; answer: string } | { ok: false; error: string }) => void }>()
const queues = new Map<string, Promise<unknown>>()

/** Runs one job at a time per goal, so two quick `crew run` calls cannot both pass the at-once check. */
export function goalQueue<T>(goalId: string, job: () => Promise<T>): Promise<T> {
  const next = (queues.get(goalId) ?? Promise.resolve()).then(job, job)
  queues.set(goalId, next.catch(() => undefined))
  return next
}

export const leadSettings = (): LeadSettings => store.state.settings.lead

export const goalById = (id: string): CrewGoal | undefined => store.state.settings.crewGoals.find((goal) => goal.id === id)

export const leadMember = () => currentMembers().find((member) => member.lead)

/** A goal is active while Maya's pane is still open, so a quiet moment between her turns does not end it. */
export const goalActive = (goal: CrewGoal): boolean => paneOfRun(goal.leadRunId) !== undefined

export const runsOfGoal = (goalId: string): CrewRun[] => store.state.settings.crewRuns.filter((run) => run.goalId === goalId)

export const liveOf = (goalId: string): GoalLive => store.state.goalLive[goalId] ?? emptyLive()

function setLive(goalId: string, change: (live: GoalLive) => GoalLive): void {
  store.set((state) => ({ ...state, goalLive: { ...state.goalLive, [goalId]: change(state.goalLive[goalId] ?? emptyLive()) } }))
}

function patchGoal(goalId: string, change: Partial<CrewGoal>): void {
  const crewGoals = store.state.settings.crewGoals.map((goal) => (goal.id === goalId ? { ...goal, ...change } : goal))
  store.set((state) => ({ ...state, settings: { ...state.settings, crewGoals } }))
  void saveSettings({ crewGoals })
}

export function updateLead(change: Partial<LeadSettings>): void {
  const lead = { ...store.state.settings.lead, ...change }
  store.set((state) => ({ ...state, settings: { ...state.settings, lead } }))
  void saveSettings({ lead })
}

function infoOf(goal: CrewGoal): LeadGoalInfo {
  return { id: goal.id, projectId: goal.projectId, projectName: goal.projectName, planFirst: goal.planFirst, approved: goal.approved }
}

function load(goalId: string): { active: number; spent: number } {
  const states = new Map(crewRunStatuses(store.state).map((status) => [status.id, status.state]))
  const runs = runsOfGoal(goalId)
  const active = runs.filter((run) => !run.lead && (states.get(run.id) === 'working' || states.get(run.id) === 'needs')).length
  return { active, spent: goalSpent(store.state.settings.crewRuns, goalId) }
}

export function decidePlanFor(goalId: string, decision: PlanDecision): void {
  const waiter = planWaiters.get(goalId)
  if (!waiter) return
  planWaiters.delete(goalId)
  setLive(goalId, (live) => decidePlan(live, decision.kind, decision.kind === 'changed' ? decision.note : ''))
  if (decision.kind === 'approved') patchGoal(goalId, { approved: true })
  waiter(decision)
}

export function answerFor(goalId: string, option: string): void {
  const waiter = askWaiters.get(goalId)
  if (!waiter) return
  askWaiters.delete(goalId)
  setLive(goalId, (live) => answerQuestion(live, waiter.id, option))
  waiter.resolve({ ok: true, answer: option })
}

function endPending(goalId: string): void {
  if (planWaiters.has(goalId)) decidePlanFor(goalId, { kind: 'cancelled' })
  const waiter = askWaiters.get(goalId)
  if (waiter) {
    askWaiters.delete(goalId)
    waiter.resolve({ ok: false, error: 'The goal ended before the question was answered.' })
  }
}

export const leadHost: LeadHost = {
  settings: leadSettings,
  goal: (id) => {
    const goal = goalById(id)
    return goal && goalActive(goal) ? infoOf(goal) : null
  },
  load,
  plan: (goalId: string, plan: LeadPlan) => {
    const earlier = planWaiters.get(goalId)
    if (earlier) {
      planWaiters.delete(goalId)
      earlier({ kind: 'cancelled' })
    }
    patchGoal(goalId, { approved: false })
    setLive(goalId, (live) => proposePlan(live, plan))
    return new Promise<PlanDecision>((resolve) => planWaiters.set(goalId, resolve))
  },
  ask: (goalId, text, options) => {
    const id = shortId()
    const result = askQuestion(liveOf(goalId), { id, text, options })
    if (!result.ok) return Promise.resolve(result)
    setLive(goalId, () => result.live)
    return new Promise((resolve) => askWaiters.set(goalId, { id, resolve }))
  },
  note: (goalId, text) => setLive(goalId, (live) => addNote(live, text, Date.now()))
}

export function installLead(): void {
  store.subscribe(() => {
    for (const goalId of new Set([...planWaiters.keys(), ...askWaiters.keys()])) {
      const goal = goalById(goalId)
      if (!goal || !goalActive(goal)) endPending(goalId)
    }
  })
}

export interface GoalInput {
  text: string
  projectId: string
  choice: RunChoice
  planFirst: boolean
}

export type GoalOutcome = { ok: true; goalId: string } | { ok: false; error: string }

/** Starts Maya as a normal Claude pane with her instructions and the goal. Everything else she does goes through `dawsha crew`. */
export async function startGoal(input: GoalInput): Promise<GoalOutcome> {
  const project = projectById(store.state, input.projectId)
  if (!project) return { ok: false, error: 'Choose a project for the goal.' }
  if (input.text.trim() === '') return { ok: false, error: 'Write the goal first.' }
  const maya = leadMember()
  if (!maya) return { ok: false, error: 'There is no Lead to hand the goal to.' }
  const lead = leadSettings()
  const { runner, model } = resolveRun(maya, input.choice)
  const goalId = shortId()
  const runId = shortId()
  const message = buildLeadMessage({
    goalId,
    goal: input.text,
    projectName: project.name,
    members: leadMembers(currentMembers(), lead, project.name),
    lead,
    planFirst: input.planFirst
  })
  const title = goalTitle(maya.name, input.text)
  const started = await startCrewSession(project.id, {
    agent: runner,
    title,
    prompt: message,
    launch: {
      instructions: composeInstructions(maya, runner),
      model,
      effort: runner === maya.runner ? maya.effort : '',
      permissions: maya.permissions,
      startup: maya.startup,
      ...(runner === 'claude' ? { allow: LEAD_ALLOW } : {})
    },
    fullAccess: crewFullAccess(runner, maya.permissions),
    identity: identityOf(maya, runId),
    background: true
  })
  if (!started) return { ok: false, error: 'Could not open a pane for the Lead.' }
  const now = Date.now()
  patchRuns((runs) => [
    {
      id: runId,
      memberId: maya.id,
      memberName: maya.name,
      projectId: project.id,
      projectName: project.name,
      title,
      runner,
      model,
      startedAt: now,
      endedAt: null,
      outcome: 'running',
      costUsd: null,
      paneId: started.paneId,
      termId: started.termId,
      goalId,
      lead: true
    },
    ...runs
  ])
  const goal: CrewGoal = {
    id: goalId,
    text: input.text.trim(),
    projectId: project.id,
    projectName: project.name,
    model: input.choice,
    planFirst: input.planFirst,
    approved: false,
    startedAt: now,
    leadRunId: runId
  }
  const crewGoals = [goal, ...store.state.settings.crewGoals].slice(0, MAX_GOALS)
  store.set((state) => ({ ...state, settings: { ...state.settings, crewGoals }, goalLive: { ...state.goalLive, [goalId]: emptyLive() } }))
  void saveSettings({ crewGoals })
  return { ok: true, goalId }
}
