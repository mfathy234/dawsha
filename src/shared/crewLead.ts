import {
  FIELD_VALUE_MAX,
  findMember,
  inScope,
  isRunChoice,
  modelLabel,
  resolveRun,
  runFields,
  type CrewMember,
  type CrewRun,
  type RunChoice
} from './crew'
import type { AgentKind } from './types'

export interface LeadRules {
  fewBig: boolean
  oneReview: boolean
  planFirst: boolean
  askFirst: boolean
}

export type AtOnce = 1 | 2 | 3

export interface LeadSettings {
  rules: LeadRules
  atOnce: AtOnce
  budgetUsd: number
  /** Members she may not use. Empty means every member. */
  excluded: string[]
}

export const DEFAULT_BUDGET_USD = 3
export const MAX_BUDGET_USD = 1000
export const MAX_GOALS = 20
export const GOAL_TEXT_MAX = 2000
export const PLAN_MAX_STEPS = 12
export const JOB_MAX = 300
export const SUMMARY_MAX = 600
export const QUESTION_MAX = 500
export const OPTION_MAX = 80
export const NOTE_MAX = 500
export const MAX_OPTIONS = 6
export const MAX_NOTES = 50

export const defaultLead = (): LeadSettings => ({
  rules: { fewBig: true, oneReview: true, planFirst: true, askFirst: true },
  atOnce: 2,
  budgetUsd: DEFAULT_BUDGET_USD,
  excluded: []
})

type Raw = Record<string, unknown>
const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')

export function sanitizeLead(value: unknown): LeadSettings {
  const base = defaultLead()
  if (!isRecord(value)) return base
  const rules = isRecord(value.rules) ? value.rules : {}
  const budget = typeof value.budgetUsd === 'number' && Number.isFinite(value.budgetUsd) ? value.budgetUsd : DEFAULT_BUDGET_USD
  return {
    rules: {
      fewBig: rules.fewBig !== false,
      oneReview: rules.oneReview !== false,
      planFirst: rules.planFirst !== false,
      askFirst: rules.askFirst !== false
    },
    atOnce: value.atOnce === 1 || value.atOnce === 3 ? value.atOnce : 2,
    budgetUsd: Math.min(MAX_BUDGET_USD, Math.max(0.1, Math.round(budget * 100) / 100)),
    excluded: Array.isArray(value.excluded)
      ? [...new Set(value.excluded.filter((id): id is string => typeof id === 'string').map((id) => id.slice(0, 60)))].slice(0, 100)
      : []
  }
}

export interface CrewGoal {
  id: string
  text: string
  projectId: string
  projectName: string
  model: RunChoice
  planFirst: boolean
  approved: boolean
  startedAt: number
  /** The run id of Maya's own session. */
  leadRunId: string
}

export function sanitizeGoals(value: unknown): CrewGoal[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const goals: CrewGoal[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const id = text(item.id, 20).replace(/[^\w-]/g, '')
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    goals.push({
      id,
      text: text(item.text, GOAL_TEXT_MAX),
      projectId: text(item.projectId, 80),
      projectName: text(item.projectName, 80),
      model: isRunChoice(item.model) ? item.model : 'default',
      planFirst: item.planFirst !== false,
      approved: item.approved === true,
      startedAt: typeof item.startedAt === 'number' && Number.isFinite(item.startedAt) ? item.startedAt : 0,
      leadRunId: text(item.leadRunId, 20).replace(/[^\w-]/g, '')
    })
  }
  return goals.sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_GOALS)
}

export function goalTitle(leadName: string, goalText: string): string {
  const line = goalText.trim().split(/\r?\n/)[0].trim()
  return `${leadName} · ${line.length > 48 ? `${line.slice(0, 47)}…` : line}`
}

export const leadAllows = (member: CrewMember, lead: LeadSettings): boolean => !member.lead && !member.hidden && !lead.excluded.includes(member.id)

export const leadMembers = (members: readonly CrewMember[], lead: LeadSettings, projectName: string): CrewMember[] =>
  members.filter((member) => leadAllows(member, lead) && inScope(member, projectName))

/** Rough cost of one typical job, in USD. Measured: a lean Sonnet reviewer on a small commit costs about $0.12. */
export function estimateRun(runner: AgentKind, model: string): number {
  if (runner === 'codex') return 0.4
  if (runner === 'gemini') return 0.15
  const name = model.toLowerCase()
  if (name.includes('haiku')) return 0.08
  if (name.includes('fable')) return 2
  if (name.includes('opus')) return 1.2
  return 0.35
}

export function formatEstimate(usd: number): string {
  return usd < 0.005 ? '~$0.00' : `~$${usd.toFixed(2)}`
}

export const formatBudget = (usd: number): string => `$${usd.toFixed(2)}`

export interface PlanStep {
  memberId: string
  memberName: string
  job: string
  choice: RunChoice
  runner: AgentKind
  model: string
  fields: Record<string, string>
  estimate: number
}

export interface LeadPlan {
  steps: PlanStep[]
  summary: string
  estimate: number
}

export interface PlanContext {
  members: readonly CrewMember[]
  lead: LeadSettings
  projectName: string
}

export type PlanResult = { ok: true; plan: LeadPlan } | { ok: false; error: string }

function validateStep(raw: unknown, index: number, context: PlanContext): { ok: true; step: PlanStep } | { ok: false; error: string } {
  const at = `Step ${index + 1}`
  if (!isRecord(raw)) return { ok: false, error: `${at} must be an object with member and job.` }
  const memberName = typeof raw.member === 'string' ? raw.member.trim() : ''
  if (memberName === '') return { ok: false, error: `${at} needs a "member".` }
  const member = findMember(context.members, memberName)
  if (!member) return { ok: false, error: `${at}: no crew member named '${memberName}'.` }
  if (member.lead) return { ok: false, error: `${at}: ${member.name} is the Lead and cannot be a step.` }
  if (!leadAllows(member, context.lead)) return { ok: false, error: `${at}: ${member.name} is not one of the members the Lead may use.` }
  if (!inScope(member, context.projectName)) return { ok: false, error: `${at}: ${member.name} is limited to ${member.projects.join(', ')}, not ${context.projectName}.` }
  const job = typeof raw.job === 'string' ? raw.job.trim() : ''
  if (job === '') return { ok: false, error: `${at} needs a "job" saying what ${member.name} does.` }
  if (job.length > JOB_MAX) return { ok: false, error: `${at}: the job is longer than ${JOB_MAX} characters.` }
  let choice: RunChoice = 'default'
  if (raw.model !== undefined) {
    if (!isRunChoice(raw.model) || raw.model === 'default') return { ok: false, error: `${at}: unknown model '${String(raw.model)}'.` }
    choice = raw.model
  }
  const given = raw.fields === undefined ? {} : raw.fields
  if (!isRecord(given)) return { ok: false, error: `${at}: "fields" must be an object of text values.` }
  const wanted = runFields(member)
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(given)) {
    if (!wanted.includes(key)) return { ok: false, error: `${at}: ${member.name} has no field '${key}'. Fields: ${wanted.join(', ')}.` }
    if (typeof value !== 'string') return { ok: false, error: `${at}: field '${key}' must be text.` }
    if (value.length > FIELD_VALUE_MAX) return { ok: false, error: `${at}: field '${key}' is too long.` }
    fields[key] = value
  }
  const missing = wanted.filter((key) => (fields[key] ?? '').trim() === '')
  if (missing.length > 0) return { ok: false, error: `${at}: ${member.name} needs the fields ${missing.join(', ')}.` }
  const { runner, model } = resolveRun(member, choice)
  return { ok: true, step: { memberId: member.id, memberName: member.name, job, choice, runner, model, fields, estimate: estimateRun(runner, model) } }
}

export function validatePlan(raw: unknown, context: PlanContext): PlanResult {
  if (!isRecord(raw)) return { ok: false, error: 'The plan must be a JSON object: { "steps": [...], "summary": "..." }.' }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) return { ok: false, error: 'The plan needs a non-empty "steps" list.' }
  if (raw.steps.length > PLAN_MAX_STEPS) return { ok: false, error: `The plan has more than ${PLAN_MAX_STEPS} steps. Hand out fewer, bigger jobs.` }
  const summary = raw.summary === undefined ? '' : typeof raw.summary === 'string' ? raw.summary.trim() : null
  if (summary === null) return { ok: false, error: '"summary" must be text.' }
  if (summary.length > SUMMARY_MAX) return { ok: false, error: `The summary is longer than ${SUMMARY_MAX} characters.` }
  const steps: PlanStep[] = []
  for (const [index, item] of raw.steps.entries()) {
    const result = validateStep(item, index, context)
    if (!result.ok) return result
    steps.push(result.step)
  }
  const estimate = steps.reduce((sum, step) => sum + step.estimate, 0)
  if (estimate > context.lead.budgetUsd + 1e-9) {
    return {
      ok: false,
      error: `The plan is estimated at ${formatEstimate(estimate)}, over the ${formatBudget(context.lead.budgetUsd)} budget. Cut a step or use cheaper models, or ask the human with dawsha crew ask.`
    }
  }
  return { ok: true, plan: { steps, summary, estimate } }
}

export interface RunLoad {
  active: number
  spent: number
}

/** What a goal has cost so far: the real cost where known, the estimate for runs still going or finished without one. */
export function goalSpent(runs: readonly CrewRun[], goalId: string): number {
  return runs
    .filter((run) => run.goalId === goalId)
    .reduce((sum, run) => {
      if (run.costUsd !== null) return sum + run.costUsd
      if (run.lead) return sum
      return run.outcome === 'running' || run.outcome === 'done' ? sum + estimateRun(run.runner, run.model) : sum
    }, 0)
}

export interface RunGate {
  member: CrewMember
  runner: AgentKind
  model: string
  lead: LeadSettings
  goal: { planFirst: boolean; approved: boolean }
  load: RunLoad
}

/** The reason a goal may not start another run, or null when it may. Dawsha enforces this, not only Maya's prompt. */
export function checkRun(gate: RunGate): string | null {
  if (!leadAllows(gate.member, gate.lead)) return `${gate.member.name} is not one of the members the Lead may use. See How she leads.`
  if (gate.goal.planFirst && !gate.goal.approved) return 'The plan is not approved yet. Send it with dawsha crew plan and wait for "approved".'
  if (gate.load.active >= gate.lead.atOnce) {
    return `${gate.load.active} ${gate.load.active === 1 ? 'member is' : 'members are'} already working and the limit is ${gate.lead.atOnce} at once. Wait for one to finish (dawsha crew status), then run this one.`
  }
  const estimate = estimateRun(gate.runner, gate.model)
  if (gate.load.spent + estimate > gate.lead.budgetUsd + 1e-9) {
    return `This run (${formatEstimate(estimate)}) would take the goal to ${formatEstimate(gate.load.spent + estimate)}, over the ${formatBudget(gate.lead.budgetUsd)} budget (about ${formatEstimate(gate.load.spent)} spent). Ask the human with dawsha crew ask before going over.`
  }
  return null
}

export type PlanStatus = 'waiting' | 'approved' | 'changed' | 'cancelled'

export interface GoalPlan extends LeadPlan {
  status: PlanStatus
  note: string
}

export interface GoalQuestion {
  id: string
  text: string
  options: string[]
  answer: string | null
}

export interface GoalNote {
  at: number
  text: string
}

export interface GoalLive {
  plan: GoalPlan | null
  question: GoalQuestion | null
  notes: GoalNote[]
}

export const emptyLive = (): GoalLive => ({ plan: null, question: null, notes: [] })

export const proposePlan = (live: GoalLive, plan: LeadPlan): GoalLive => ({ ...live, plan: { ...plan, status: 'waiting', note: '' } })

export function decidePlan(live: GoalLive, status: Exclude<PlanStatus, 'waiting'>, note = ''): GoalLive {
  if (!live.plan || live.plan.status !== 'waiting') return live
  return { ...live, plan: { ...live.plan, status, note: note.trim() } }
}

export type AskResult = { ok: true; live: GoalLive } | { ok: false; error: string }

export function askQuestion(live: GoalLive, question: { id: string; text: string; options: readonly string[] }): AskResult {
  if (live.question && live.question.answer === null) return { ok: false, error: 'A question is already waiting for an answer. Wait for it before asking another.' }
  const options = [...new Set(question.options.map((option) => option.trim()).filter((option) => option !== ''))]
  if (question.text.trim() === '') return { ok: false, error: 'The question is empty.' }
  if (options.length < 2) return { ok: false, error: 'Give at least two different --option values.' }
  if (options.length > MAX_OPTIONS) return { ok: false, error: `Give at most ${MAX_OPTIONS} options.` }
  if (options.some((option) => option.length > OPTION_MAX)) return { ok: false, error: `Each option must be ${OPTION_MAX} characters or fewer.` }
  return { ok: true, live: { ...live, question: { id: question.id, text: question.text.trim().slice(0, QUESTION_MAX), options, answer: null } } }
}

export function answerQuestion(live: GoalLive, id: string, option: string): GoalLive {
  const question = live.question
  if (!question || question.id !== id || question.answer !== null || !question.options.includes(option)) return live
  return { ...live, question: { ...question, answer: option } }
}

export const openQuestion = (live: GoalLive | undefined): GoalQuestion | null => (live?.question && live.question.answer === null ? live.question : null)

/** True while the Lead's session waits on the human: a plan to approve or a question to answer. */
export function leadWaiting(goals: readonly CrewGoal[], live: Readonly<Record<string, GoalLive>>, runId: string): boolean {
  const goal = goals.find((entry) => entry.leadRunId === runId)
  const state = goal ? live[goal.id] : undefined
  return openQuestion(state) !== null || state?.plan?.status === 'waiting'
}

export function addNote(live: GoalLive, textValue: string, at: number): GoalLive {
  const clean = textValue.trim().slice(0, NOTE_MAX)
  return clean === '' ? live : { ...live, notes: [...live.notes, { at, text: clean }].slice(-MAX_NOTES) }
}

export interface Lane {
  index: number
  step: PlanStep | null
  run: CrewRun | null
}

/** One lane per planned step, in order. A run takes the first unclaimed step of its member; runs the plan did not mention get their own lanes. */
export function buildLanes(steps: readonly PlanStep[], runs: readonly CrewRun[]): Lane[] {
  const ordered = runs.filter((run) => !run.lead).sort((a, b) => a.startedAt - b.startedAt)
  const claimed = new Set<string>()
  const lanes: Lane[] = steps.map((step, index) => {
    const run = ordered.find((candidate) => !claimed.has(candidate.id) && candidate.memberId === step.memberId) ?? null
    if (run) claimed.add(run.id)
    return { index, step, run }
  })
  for (const run of ordered) if (!claimed.has(run.id)) lanes.push({ index: lanes.length, step: null, run })
  return lanes
}

export interface LeadMessage {
  goalId: string
  goal: string
  projectName: string
  members: readonly CrewMember[]
  lead: LeadSettings
  planFirst: boolean
}

export const memberLine = (member: CrewMember): string =>
  `- ${member.name}, ${member.role || 'member'} (${member.runner} ${modelLabel(member.runner, member.model)}), fields: ${runFields(member).join(', ')}`

const PLAN_EXAMPLE =
  '{"summary":"One line on the approach","steps":[{"member":"Omar","job":"Fix it in a new worktree with a test","model":"sonnet","fields":{"task":"..."}}]}'

/** The first message Maya receives: the goal, her limits and the exact commands, so she needs no other context. */
export function buildLeadMessage(input: LeadMessage): string {
  const { lead, goalId } = input
  const rules: string[] = []
  if (lead.rules.fewBig) rules.push('Hand out a few big jobs, never many small ones.')
  if (lead.rules.oneReview) rules.push('Have one review at the end, not one per job.')
  if (lead.rules.askFirst) rules.push('Before you push, merge, post comments or delete anything, ask the human with `dawsha crew ask` and wait for the answer.')
  rules.push(`Run at most ${lead.atOnce} ${lead.atOnce === 1 ? 'member' : 'members'} at once. Dawsha refuses a run past that.`)
  rules.push(`Stay within the budget of ${formatBudget(lead.budgetUsd)} for this goal. Dawsha refuses a run that would pass it, and then you must ask the human.`)
  const members = input.members.length === 0 ? ['- (none: tell the human with dawsha crew note)'] : input.members.map(memberLine)
  const cmd = (rest: string): string => `  dawsha crew ${rest}`
  const planStep = input.planFirst
    ? [
        '1. Write a plan as JSON to a file, for example in your temp folder, then run:',
        cmd(`plan --goal ${goalId} --file <plan.json>`),
        `   Shape: ${PLAN_EXAMPLE}`,
        '   The command waits. It prints "approved" (exit 0) and you may start. If it exits 3 the human wants changes: read the note it prints, fix the plan and send it again. If it exits 2 the human cancelled: stop.'
      ]
    : ['1. The human skipped plan approval, so start right away. You can still send a plan with `dawsha crew plan` if it helps.']
  return [
    `Goal: ${input.goal.trim()}`,
    `Project: ${input.projectName}. Every member you run works in this project.`,
    `Goal id: ${goalId}. Pass it as --goal ${goalId} to every dawsha crew command below.`,
    '',
    'Members you may use:',
    ...members,
    '',
    'Rules:',
    ...rules.map((rule) => `- ${rule}`),
    '',
    'How to work:',
    ...planStep,
    '2. Start each job and note its run id:',
    cmd(`run <member> --project "${input.projectName}" --goal ${goalId} --field name=value [--model sonnet|opus|haiku|fable|codex|gemini]`),
    '3. Wait for a job by polling, then read what it said:',
    cmd('status <run>   (working, needs, done, failed, idle or closed)'),
    cmd('result <run>'),
    '4. Tell the human what is happening in one short line at a time:',
    cmd(`note --goal ${goalId} "<text>"`),
    '5. When you need a decision, ask and wait for the printed answer:',
    cmd(`ask --goal ${goalId} "<question>" --option "<first choice>" --option "<second choice>"`),
    '',
    "Finish with a short summary of what was done and what is left. Do not do the members' work yourself."
  ].join('\n')
}
