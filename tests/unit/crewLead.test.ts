import { describe, expect, it } from 'vitest'
import type { CrewRun } from '../../src/shared/crew'
import { crewMembers } from '../../src/shared/crewBuiltins'
import { defaultCrew } from '../../src/shared/crew'
import {
  addNote,
  answerQuestion,
  askQuestion,
  buildLanes,
  buildLeadMessage,
  checkRun,
  decidePlan,
  defaultLead,
  emptyLive,
  estimateRun,
  formatEstimate,
  goalSpent,
  goalTitle,
  leadMembers,
  leadWaiting,
  openQuestion,
  proposePlan,
  sanitizeGoals,
  sanitizeLead,
  validatePlan,
  type LeadSettings
} from '../../src/shared/crewLead'

const MEMBERS = crewMembers(defaultCrew())
const member = (id: string) => MEMBERS.find((m) => m.id === id)!
const lead = (over: Partial<LeadSettings> = {}): LeadSettings => ({ ...defaultLead(), ...over })
const context = (over: Partial<LeadSettings> = {}, projectName = 'acme-web') => ({ members: MEMBERS, lead: lead(over), projectName })

const run = (over: Partial<CrewRun>): CrewRun => ({
  id: 'r1',
  memberId: 'sami',
  memberName: 'Sami',
  projectId: 'p',
  projectName: 'acme-web',
  title: 'Sami · PR 1',
  runner: 'claude',
  model: 'sonnet',
  startedAt: 1,
  endedAt: null,
  outcome: 'running',
  costUsd: null,
  paneId: 'x',
  termId: 'y',
  goalId: 'g1',
  ...over
})

describe('plan validation', () => {
  const step = { member: 'Omar', job: 'Fix it in a worktree', fields: { task: 'fix the login test' } }

  it('accepts a plan, resolves members by name or id and computes the estimate', () => {
    const result = validatePlan({ summary: 'Fix then review', steps: [step, { member: 'sami', job: 'Review once', model: 'haiku', fields: { target: 'the branch' } }] }, context())
    if (!result.ok) throw new Error(result.error)
    expect(result.plan.steps.map((s) => [s.memberName, s.runner, s.model])).toEqual([['Omar', 'claude', 'sonnet'], ['Sami', 'claude', 'haiku']])
    expect(result.plan.estimate).toBeCloseTo(0.35 + 0.08)
    expect(result.plan.summary).toBe('Fix then review')
  })

  it('refuses things that are not a plan', () => {
    for (const bad of [null, 'x', [], {}, { steps: [] }, { steps: 'no' }]) expect(validatePlan(bad, context()).ok).toBe(false)
    expect(validatePlan({ steps: [step], summary: 5 }, context())).toMatchObject({ ok: false, error: '"summary" must be text.' })
    expect(validatePlan({ steps: Array.from({ length: 13 }, () => step) }, context())).toMatchObject({ ok: false, error: expect.stringContaining('more than 12 steps') })
  })

  it('names the step and the problem for unknown, blocked and wrongly scoped members', () => {
    expect(validatePlan({ steps: [step, { member: 'Nobody', job: 'x' }] }, context())).toEqual({ ok: false, error: "Step 2: no crew member named 'Nobody'." })
    expect(validatePlan({ steps: [{ member: 'Maya', job: 'x', fields: { goal: 'g' } }] }, context())).toMatchObject({ ok: false, error: expect.stringContaining('is the Lead') })
    expect(validatePlan({ steps: [step] }, context({ excluded: ['omar'] }))).toMatchObject({ ok: false, error: expect.stringContaining('Omar is not one of the members the Lead may use') })
    const scoped = { ...context(), members: MEMBERS.map((m) => (m.id === 'omar' ? { ...m, projects: ['billing-api'] } : m)) }
    expect(validatePlan({ steps: [step] }, scoped)).toMatchObject({ ok: false, error: expect.stringContaining('limited to billing-api') })
  })

  it('checks the job, the model and the fields', () => {
    expect(validatePlan({ steps: [{ member: 'Omar', fields: { task: 'x' } }] }, context())).toMatchObject({ ok: false, error: expect.stringContaining('needs a "job"') })
    expect(validatePlan({ steps: [{ ...step, job: 'x'.repeat(301) }] }, context())).toMatchObject({ ok: false, error: expect.stringContaining('longer than 300') })
    expect(validatePlan({ steps: [{ ...step, model: 'gpt' }] }, context())).toMatchObject({ ok: false, error: "Step 1: unknown model 'gpt'." })
    expect(validatePlan({ steps: [{ ...step, model: 'default' }] }, context()).ok).toBe(false)
    expect(validatePlan({ steps: [{ ...step, fields: { task: 'x', extra: 'y' } }] }, context())).toMatchObject({ ok: false, error: expect.stringContaining("has no field 'extra'") })
    expect(validatePlan({ steps: [{ ...step, fields: {} }] }, context())).toMatchObject({ ok: false, error: expect.stringContaining('needs the fields task') })
    expect(validatePlan({ steps: [{ ...step, fields: { task: 3 } }] }, context())).toMatchObject({ ok: false, error: "Step 1: field 'task' must be text." })
    expect(validatePlan({ steps: [{ ...step, fields: 'x' }] }, context()).ok).toBe(false)
  })

  it('refuses a plan whose estimate is over the budget', () => {
    const big = { member: 'Omar', job: 'Build', model: 'opus', fields: { task: 't' } }
    const result = validatePlan({ steps: [big, big, big] }, context({ budgetUsd: 3 }))
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('over the $3.00 budget') })
    expect(validatePlan({ steps: [big, big] }, context({ budgetUsd: 3 })).ok).toBe(true)
  })
})

describe('cost estimate', () => {
  it('buckets by model and runner', () => {
    expect(estimateRun('claude', 'haiku')).toBeLessThan(estimateRun('claude', 'sonnet'))
    expect(estimateRun('claude', 'sonnet')).toBeLessThan(estimateRun('claude', 'opus'))
    expect(estimateRun('claude', 'opus')).toBeLessThan(estimateRun('claude', 'fable'))
    expect(estimateRun('claude', 'claude-opus-4-1')).toBe(estimateRun('claude', 'opus'))
    expect(estimateRun('codex', '')).toBe(0.4)
    expect(estimateRun('gemini', 'gemini-2.5-flash')).toBe(0.15)
    expect(estimateRun('claude', '')).toBe(estimateRun('claude', 'sonnet'))
  })

  it('formats a rough figure', () => {
    expect(formatEstimate(0.35)).toBe('~$0.35')
    expect(formatEstimate(1.2)).toBe('~$1.20')
    expect(formatEstimate(0)).toBe('~$0.00')
  })

  it('sums what a goal has cost: real cost first, estimates for running or finished runs without one', () => {
    const runs = [
      run({ id: 'a', costUsd: 0.5 }),
      run({ id: 'b', costUsd: null, outcome: 'running' }),
      run({ id: 'c', costUsd: null, outcome: 'done', runner: 'codex', model: '' }),
      run({ id: 'd', costUsd: null, outcome: 'closed' }),
      run({ id: 'e', costUsd: null, outcome: 'failed' }),
      run({ id: 'f', costUsd: null, lead: true, memberId: 'maya' }),
      run({ id: 'g', goalId: 'other', costUsd: 9 })
    ]
    expect(goalSpent(runs, 'g1')).toBeCloseTo(0.5 + 0.35 + 0.4)
    expect(goalSpent([], 'g1')).toBe(0)
  })
})

describe('at once and budget enforcement', () => {
  const gate = (over: Partial<Parameters<typeof checkRun>[0]> = {}) => ({
    member: member('omar'),
    runner: 'claude' as const,
    model: 'sonnet',
    lead: lead(),
    goal: { planFirst: true, approved: true },
    load: { active: 0, spent: 0 },
    ...over
  })

  it('lets a run through when everything is in order', () => {
    expect(checkRun(gate())).toBeNull()
  })

  it('refuses a member the Lead may not use, and the Lead itself', () => {
    expect(checkRun(gate({ lead: lead({ excluded: ['omar'] }) }))).toContain('Omar is not one of the members')
    expect(checkRun(gate({ member: member('maya') }))).toContain('Maya is not one of the members')
    expect(checkRun(gate({ member: { ...member('omar'), hidden: true } }))).toContain('not one of the members')
  })

  it('refuses before the plan is approved when the plan comes first', () => {
    expect(checkRun(gate({ goal: { planFirst: true, approved: false } }))).toContain('plan is not approved')
    expect(checkRun(gate({ goal: { planFirst: false, approved: false } }))).toBeNull()
  })

  it('refuses when "at once" runs are already working', () => {
    expect(checkRun(gate({ load: { active: 1, spent: 0 } }))).toBeNull()
    expect(checkRun(gate({ load: { active: 2, spent: 0 } }))).toContain('limit is 2 at once')
    expect(checkRun(gate({ load: { active: 1, spent: 0 }, lead: lead({ atOnce: 1 }) }))).toContain('1 member is already working and the limit is 1 at once')
    expect(checkRun(gate({ load: { active: 2, spent: 0 }, lead: lead({ atOnce: 3 }) }))).toBeNull()
  })

  it('refuses a run that would pass the budget, and says what to do', () => {
    expect(checkRun(gate({ load: { active: 0, spent: 2.6 } }))).toBeNull()
    const refusal = checkRun(gate({ load: { active: 0, spent: 2.7 } }))
    expect(refusal).toContain('over the $3.00 budget')
    expect(refusal).toContain('dawsha crew ask')
    expect(checkRun(gate({ model: 'opus', lead: lead({ budgetUsd: 1 }) }))).toContain('over the $1.00 budget')
  })

  it('checks in order: member, plan, at once, budget', () => {
    expect(checkRun(gate({ lead: lead({ excluded: ['omar'] }), goal: { planFirst: true, approved: false }, load: { active: 5, spent: 99 } }))).toContain('not one of the members')
    expect(checkRun(gate({ goal: { planFirst: true, approved: false }, load: { active: 5, spent: 99 } }))).toContain('not approved')
    expect(checkRun(gate({ load: { active: 5, spent: 99 } }))).toContain('at once')
  })
})

describe('the question and answer state machine', () => {
  const q = { id: 'q1', text: 'Should I push?', options: ['Push and open the PR', 'Keep it local'] }

  it('opens a question, then records one answer', () => {
    const asked = askQuestion(emptyLive(), q)
    if (!asked.ok) throw new Error(asked.error)
    expect(openQuestion(asked.live)).toMatchObject({ id: 'q1', answer: null })
    const answered = answerQuestion(asked.live, 'q1', 'Keep it local')
    expect(openQuestion(answered)).toBeNull()
    expect(answered.question?.answer).toBe('Keep it local')
    expect(answerQuestion(answered, 'q1', 'Push and open the PR').question?.answer).toBe('Keep it local')
  })

  it('ignores answers for another question or an option that was not offered', () => {
    const asked = askQuestion(emptyLive(), q)
    if (!asked.ok) throw new Error(asked.error)
    expect(answerQuestion(asked.live, 'other', 'Keep it local')).toBe(asked.live)
    expect(answerQuestion(asked.live, 'q1', 'Burn it down')).toBe(asked.live)
    expect(answerQuestion(emptyLive(), 'q1', 'x')).toEqual(emptyLive())
  })

  it('allows only one open question at a time, and a new one after the answer', () => {
    const first = askQuestion(emptyLive(), q)
    if (!first.ok) throw new Error(first.error)
    expect(askQuestion(first.live, { ...q, id: 'q2' })).toMatchObject({ ok: false, error: expect.stringContaining('already waiting') })
    const answered = answerQuestion(first.live, 'q1', 'Keep it local')
    expect(askQuestion(answered, { ...q, id: 'q2' }).ok).toBe(true)
  })

  it('validates the question and the options', () => {
    expect(askQuestion(emptyLive(), { ...q, text: '  ' }).ok).toBe(false)
    expect(askQuestion(emptyLive(), { ...q, options: ['only one'] }).ok).toBe(false)
    expect(askQuestion(emptyLive(), { ...q, options: ['same', 'same', ' '] }).ok).toBe(false)
    expect(askQuestion(emptyLive(), { ...q, options: ['1', '2', '3', '4', '5', '6', '7'] }).ok).toBe(false)
    expect(askQuestion(emptyLive(), { ...q, options: ['ok', 'x'.repeat(81)] }).ok).toBe(false)
  })

  it('waits on the human while a plan is waiting or a question is open, and not afterwards', () => {
    const goals = sanitizeGoals([{ id: 'g1', leadRunId: 'lr', projectId: 'p', projectName: 'acme-web', startedAt: 1 }])
    expect(leadWaiting(goals, {}, 'lr')).toBe(false)
    const planned = proposePlan(emptyLive(), { steps: [], summary: '', estimate: 0 })
    expect(leadWaiting(goals, { g1: planned }, 'lr')).toBe(true)
    expect(leadWaiting(goals, { g1: decidePlan(planned, 'approved') }, 'lr')).toBe(false)
    const asked = askQuestion(emptyLive(), q)
    if (!asked.ok) throw new Error(asked.error)
    expect(leadWaiting(goals, { g1: asked.live }, 'lr')).toBe(true)
    expect(leadWaiting(goals, { g1: answerQuestion(asked.live, 'q1', 'Keep it local') }, 'lr')).toBe(false)
    expect(leadWaiting(goals, { g1: asked.live }, 'someone-else')).toBe(false)
  })
})

describe('plan decisions and notes', () => {
  const plan = { steps: [], summary: 's', estimate: 0 }

  it('moves a waiting plan to one decision and keeps the note', () => {
    const waiting = proposePlan(emptyLive(), plan)
    expect(waiting.plan?.status).toBe('waiting')
    expect(decidePlan(waiting, 'changed', '  skip the review  ').plan).toMatchObject({ status: 'changed', note: 'skip the review' })
    expect(decidePlan(waiting, 'cancelled').plan?.status).toBe('cancelled')
  })

  it('does not decide twice, and a new plan starts waiting again', () => {
    const approved = decidePlan(proposePlan(emptyLive(), plan), 'approved')
    expect(decidePlan(approved, 'cancelled')).toBe(approved)
    expect(decidePlan(emptyLive(), 'approved')).toEqual(emptyLive())
    expect(proposePlan(approved, plan).plan?.status).toBe('waiting')
  })

  it('keeps the last fifty short notes and drops empty ones', () => {
    let live = emptyLive()
    for (let n = 0; n < 60; n += 1) live = addNote(live, `note ${n}`, n)
    expect(live.notes).toHaveLength(50)
    expect(live.notes[0].text).toBe('note 10')
    expect(addNote(live, '   ', 1)).toBe(live)
    expect(addNote(emptyLive(), 'x'.repeat(900), 1).notes[0].text).toHaveLength(500)
  })
})

describe('lanes', () => {
  const steps = validatePlan(
    {
      steps: [
        { member: 'Tarek', job: 'Find the cause', fields: { problem: 'flaky' } },
        { member: 'Omar', job: 'Fix it', fields: { task: 'fix' } },
        { member: 'Sami', job: 'Review', fields: { target: 'branch' } }
      ]
    },
    context()
  )

  it('gives one lane per step and links each run to the first free step of its member', () => {
    if (!steps.ok) throw new Error(steps.error)
    const lanes = buildLanes(steps.plan.steps, [run({ id: 'o', memberId: 'omar', startedAt: 5 }), run({ id: 't', memberId: 'tarek', startedAt: 2 })])
    expect(lanes.map((l) => [l.step?.memberName, l.run?.id ?? null])).toEqual([['Tarek', 't'], ['Omar', 'o'], ['Sami', null]])
  })

  it('adds a lane for a run the plan did not mention, never for the Lead', () => {
    if (!steps.ok) throw new Error(steps.error)
    const lanes = buildLanes(steps.plan.steps, [run({ id: 'x', memberId: 'yara', memberName: 'Yara', startedAt: 9 }), run({ id: 'm', memberId: 'maya', lead: true })])
    expect(lanes).toHaveLength(4)
    expect(lanes[3]).toMatchObject({ step: null, run: { id: 'x' } })
  })

  it('shows only the runs as lanes when there is no plan, and repeats a member for repeated steps', () => {
    expect(buildLanes([], [run({ id: 'a' }), run({ id: 'b', startedAt: 3 })]).map((l) => l.run?.id)).toEqual(['a', 'b'])
    if (!steps.ok) throw new Error(steps.error)
    const twice = [...steps.plan.steps, steps.plan.steps[2]]
    const lanes = buildLanes(twice, [run({ id: 's1', startedAt: 1 }), run({ id: 's2', startedAt: 2 })])
    expect(lanes.map((l) => l.run?.id ?? null)).toEqual([null, null, 's1', 's2'])
  })
})

describe('Lead settings and goals', () => {
  it('defaults to the owner rules, two at once and a $3 budget', () => {
    expect(sanitizeLead(undefined)).toEqual({ rules: { fewBig: true, oneReview: true, planFirst: true, askFirst: true }, atOnce: 2, budgetUsd: 3, excluded: [] })
  })

  it('keeps valid values and repairs the rest', () => {
    expect(sanitizeLead({ rules: { fewBig: false, askFirst: 'no' }, atOnce: 3, budgetUsd: 7.456, excluded: ['omar', 'omar', 4, 'x'] })).toEqual({
      rules: { fewBig: false, oneReview: true, planFirst: true, askFirst: true },
      atOnce: 3,
      budgetUsd: 7.46,
      excluded: ['omar', 'x']
    })
    expect(sanitizeLead({ atOnce: 9, budgetUsd: -4 })).toMatchObject({ atOnce: 2, budgetUsd: 0.1 })
    expect(sanitizeLead({ budgetUsd: 'lots' }).budgetUsd).toBe(3)
    expect(sanitizeLead({ budgetUsd: 1e9 }).budgetUsd).toBe(1000)
  })

  it('sanitizes goals, newest first, without duplicates', () => {
    const goals = sanitizeGoals([
      { id: 'a', text: 'old', startedAt: 1, leadRunId: 'r1', model: 'sonnet', approved: true },
      { id: 'a', text: 'dup' },
      { id: 'b/../x', text: 'new', startedAt: 5, model: 'nope', planFirst: false },
      'junk'
    ])
    expect(goals.map((g) => g.id)).toEqual(['bx', 'a'])
    expect(goals[0]).toMatchObject({ model: 'default', planFirst: false, approved: false })
    expect(goals[1]).toMatchObject({ model: 'sonnet', approved: true })
    expect(sanitizeGoals('x')).toEqual([])
  })

  it('titles Maya\'s pane with the first line of the goal', () => {
    expect(goalTitle('Maya', 'Fix the flaky login test\nand tell me why')).toBe('Maya · Fix the flaky login test')
    expect(goalTitle('Maya', 'x'.repeat(80))).toBe(`Maya · ${'x'.repeat(47)}…`)
  })

  it('offers only members the Lead may use in the project', () => {
    const scoped = MEMBERS.map((m) => (m.id === 'lina' ? { ...m, projects: ['billing-api'] } : m))
    const names = leadMembers(scoped, lead({ excluded: ['omar'] }), 'acme-web').map((m) => m.name)
    expect(names).not.toContain('Maya')
    expect(names).not.toContain('Omar')
    expect(names).not.toContain('Lina')
    expect(names).toContain('Sami')
  })
})

describe('the Lead first message', () => {
  const message = (over: Partial<Parameters<typeof buildLeadMessage>[0]> = {}) =>
    buildLeadMessage({ goalId: 'k3m9qz', goal: 'Fix the flaky login test', projectName: 'acme-web', members: leadMembers(MEMBERS, lead(), 'acme-web'), lead: lead(), planFirst: true, ...over })

  it('carries the goal, project, members with roles and fields, and the goal id', () => {
    const text = message()
    expect(text).toContain('Goal: Fix the flaky login test')
    expect(text).toContain('Project: acme-web')
    expect(text).toContain('Goal id: k3m9qz')
    expect(text).toContain('- Sami, Code reviewer (claude Sonnet), fields: target')
    expect(text).toContain('- Omar, Builder (claude Sonnet), fields: task')
    expect(text).not.toContain('- Maya')
  })

  it('states the rules and limits from settings', () => {
    const text = message()
    expect(text).toContain('a few big jobs')
    expect(text).toContain('one review at the end')
    expect(text).toContain('ask the human with `dawsha crew ask`')
    expect(text).toContain('at most 2 members at once')
    expect(text).toContain('budget of $3.00')
    const custom = message({ lead: lead({ atOnce: 1, budgetUsd: 1.5, rules: { fewBig: false, oneReview: false, planFirst: true, askFirst: false } }) })
    expect(custom).toContain('at most 1 member at once')
    expect(custom).toContain('budget of $1.50')
    expect(custom).not.toContain('a few big jobs')
    expect(custom).not.toContain('one review at the end')
    expect(custom).not.toContain('Before you push')
  })

  it('lists the exact commands with the goal id', () => {
    const text = message()
    expect(text).toContain('dawsha crew plan --goal k3m9qz --file <plan.json>')
    expect(text).toContain('dawsha crew run <member> --project "acme-web" --goal k3m9qz --field name=value')
    expect(text).toContain('dawsha crew status <run>')
    expect(text).toContain('dawsha crew result <run>')
    expect(text).toContain('dawsha crew note --goal k3m9qz "<text>"')
    expect(text).toContain('dawsha crew ask --goal k3m9qz "<question>" --option')
    expect(text).toContain('exits 3')
  })

  it('skips the plan step when the human does not want to see it first', () => {
    const text = message({ planFirst: false })
    expect(text).toContain('skipped plan approval')
    expect(text).not.toContain('exits 3')
  })

  it('says so when no member is available', () => {
    expect(message({ members: [] })).toContain('(none')
  })
})
