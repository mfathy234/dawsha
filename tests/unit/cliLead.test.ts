import { describe, expect, it, vi } from 'vitest'
import { parseCli, runCli, type CliCommand, type CliHost, type LeadHost, type PlanDecision } from '../../src/shared/cli'
import { defaultCrew } from '../../src/shared/crew'
import { crewMembers } from '../../src/shared/crewBuiltins'
import { defaultLead, type LeadSettings } from '../../src/shared/crewLead'
import type { Project } from '../../src/shared/types'

const resolvePath = (path: string): string => (/^[A-Za-z]:/.test(path) ? path : `C:\\work\\${path}`)
const parse = (...args: string[]) => parseCli(args, 'C:\\work\\acme-web', resolvePath)

const PROJECTS: Project[] = [
  { id: 'a', name: 'acme-web', folder: 'C:\\work\\acme-web', defaultAgent: 'claude' },
  { id: 'b', name: 'billing-api', folder: 'C:\\work\\billing-api', defaultAgent: 'codex' }
]

const GOAL = { id: 'g1', projectId: 'a', projectName: 'acme-web', planFirst: true, approved: true }

function lead(over: Partial<LeadHost> = {}, settings: Partial<LeadSettings> = {}): LeadHost {
  return {
    settings: () => ({ ...defaultLead(), ...settings }),
    goal: (id) => (id === 'g1' ? GOAL : null),
    load: () => ({ active: 0, spent: 0 }),
    plan: vi.fn(async (): Promise<PlanDecision> => ({ kind: 'approved' })),
    ask: vi.fn(async (_goal: string, _question: string, options: string[]) => ({ ok: true as const, answer: options[1] })),
    note: vi.fn(),
    ...over
  }
}

function host(over: Partial<CliHost> = {}, leadHost: LeadHost = lead()): CliHost {
  return {
    version: '1',
    projects: PROJECTS,
    layouts: [],
    now: 0,
    openCount: () => 0,
    listSessions: vi.fn(async () => []),
    addProject: vi.fn(),
    startSession: vi.fn(async () => 1),
    resumeSession: vi.fn(),
    openResumePicker: vi.fn(),
    openLayout: vi.fn(),
    updateAgents: vi.fn(),
    crewMembers: () => crewMembers(defaultCrew()),
    crewRun: vi.fn(async () => ({ ok: true as const, runId: 'k3m9qz' })),
    crewRuns: () => [],
    crewResult: vi.fn(async () => ''),
    lead: leadHost,
    ...over
  } as CliHost
}

const run = (command: CliCommand, h: CliHost = host()) => runCli(command, h)
const PLAN = JSON.stringify({ summary: 'Fix then review', steps: [{ member: 'Omar', job: 'Fix it', fields: { task: 'fix' } }] })

describe('plan, ask and note parsing', () => {
  it('parses plan with a goal and a file resolved against the working folder', () => {
    expect(parse('crew', 'plan', '--goal', 'g1', '--file', 'plan.json')).toEqual({ ok: true, command: { kind: 'crew-plan', goal: 'g1', file: 'C:\\work\\plan.json' } })
    expect(parse('crew', 'plan', '--goal=g1', '--file=C:\\tmp\\p.json')).toEqual({ ok: true, command: { kind: 'crew-plan', goal: 'g1', file: 'C:\\tmp\\p.json' } })
  })

  it('parses ask with the question and repeated options in order', () => {
    expect(parse('crew', 'ask', '--goal', 'g1', 'Should I push?', '--option', 'Push and open the PR', '--option', 'Keep it local')).toEqual({
      ok: true,
      command: { kind: 'crew-ask', goal: 'g1', question: 'Should I push?', options: ['Push and open the PR', 'Keep it local'] }
    })
    expect(parse('crew', 'ask', '--option=a', '--option=b', '--goal=g1', 'Unquoted', 'question')).toMatchObject({ command: { question: 'Unquoted question', options: ['a', 'b'] } })
  })

  it('parses note text, quoted or not', () => {
    expect(parse('crew', 'note', '--goal', 'g1', 'Omar is on it')).toEqual({ ok: true, command: { kind: 'crew-note', goal: 'g1', text: 'Omar is on it' } })
    expect(parse('crew', 'note', 'two', 'words', '--goal', 'g1')).toMatchObject({ command: { text: 'two words' } })
  })

  it('asks for what is missing in plain words', () => {
    expect(parse('crew', 'plan', '--file', 'p.json')).toEqual({ ok: false, error: 'crew plan needs --goal <id>.' })
    expect(parse('crew', 'plan', '--goal', 'g1')).toEqual({ ok: false, error: 'crew plan needs --file <plan.json>.' })
    expect(parse('crew', 'plan', '--goal', 'g1', '--file', 'p.json', 'extra')).toEqual({ ok: false, error: "Unexpected argument 'extra'." })
    expect(parse('crew', 'ask', '--goal', 'g1', '--option', 'a', '--option', 'b')).toEqual({ ok: false, error: 'crew ask needs the question.' })
    expect(parse('crew', 'ask', '--goal', 'g1', 'Q?', '--option', 'a')).toEqual({ ok: false, error: 'crew ask needs at least two --option values.' })
    expect(parse('crew', 'ask', 'Q?', '--option', 'a', '--option', 'b')).toEqual({ ok: false, error: 'crew ask needs --goal <id>.' })
    expect(parse('crew', 'note', '--goal', 'g1')).toEqual({ ok: false, error: 'crew note needs the text of the note.' })
    expect(parse('crew', 'plan', '--goal')).toEqual({ ok: false, error: '--goal needs a value.' })
    expect(parse('crew', 'ask', '--goal', 'g1', 'Q', '--option')).toEqual({ ok: false, error: '--option needs a value.' })
  })

  it('lets run take --goal, and then the project is optional', () => {
    expect(parse('crew', 'run', 'omar', '--goal', 'g1', '--project', 'acme-web', '--field', 'task=x')).toEqual({
      ok: true,
      command: { kind: 'crew-run', member: 'omar', project: 'acme-web', path: null, choice: 'default', fields: { task: 'x' }, background: false, goal: 'g1' }
    })
    expect(parse('crew', 'run', 'omar', '--goal', 'g1', '--field', 'task=x')).toMatchObject({ ok: true, command: { project: null, path: null, goal: 'g1' } })
    expect(parse('crew', 'run', 'omar', '--field', 'task=x')).toEqual({ ok: false, error: 'crew run needs --project <name|path>.' })
  })

  it('accepts the new options only after crew, so other commands still refuse them', () => {
    expect(parse('ls', '--goal', 'x')).toEqual({ ok: false, error: "Unknown option '--goal'." })
  })
})

describe('crew plan', () => {
  const plan = (text: string | undefined, h: CliHost = host()) => run({ kind: 'crew-plan', goal: 'g1', file: 'C:\\p.json', text }, h)

  it('prints approved on approval and sends the checked plan to the human', async () => {
    const l = lead()
    expect(await plan(PLAN, host({}, l))).toEqual({ ok: true, exit: 0, out: 'approved' })
    expect(l.plan).toHaveBeenCalledWith('g1', expect.objectContaining({ summary: 'Fix then review', steps: [expect.objectContaining({ memberName: 'Omar', model: 'sonnet' })] }))
  })

  it('prints the human note and exits 3 for "Change the plan"', async () => {
    const l = lead({ plan: vi.fn(async (): Promise<PlanDecision> => ({ kind: 'changed', note: 'Skip the review' })) })
    expect(await plan(PLAN, host({}, l))).toEqual({ ok: false, exit: 3, out: 'Skip the review' })
    const blank = lead({ plan: vi.fn(async (): Promise<PlanDecision> => ({ kind: 'changed', note: '' })) })
    expect(await plan(PLAN, host({}, blank))).toMatchObject({ exit: 3, out: expect.stringContaining('wants changes') })
  })

  it('exits 2 on Cancel', async () => {
    const l = lead({ plan: vi.fn(async (): Promise<PlanDecision> => ({ kind: 'cancelled' })) })
    expect(await plan(PLAN, host({}, l))).toEqual({ ok: false, exit: 2, out: 'cancelled' })
  })

  it('refuses a bad file or plan without bothering the human', async () => {
    const l = lead()
    const h = host({}, l)
    expect(await plan(undefined, h)).toMatchObject({ ok: false, exit: 1, out: 'Could not read C:\\p.json.' })
    expect(await plan('{nope', h)).toMatchObject({ ok: false, exit: 1, out: 'C:\\p.json is not valid JSON.' })
    expect(await plan(JSON.stringify({ steps: [{ member: 'Nobody', job: 'x' }] }), h)).toMatchObject({ ok: false, exit: 1, out: "Step 1: no crew member named 'Nobody'." })
    expect(await plan(PLAN, host({}, lead({}, { excluded: ['omar'] })))).toMatchObject({ ok: false, out: expect.stringContaining('not one of the members') })
    expect(l.plan).not.toHaveBeenCalled()
  })

  it('refuses an unknown or ended goal and a host without the Lead', async () => {
    expect(await run({ kind: 'crew-plan', goal: 'nope', file: 'f', text: PLAN })).toMatchObject({ ok: false, out: "No active goal 'nope'. Use the goal id from your first message." })
    expect(await run({ kind: 'crew-plan', goal: 'g1', file: 'f', text: PLAN }, host({ lead: undefined }))).toMatchObject({ ok: false, out: 'The Lead is not available.' })
  })
})

describe('crew ask and note', () => {
  it('prints the option the human picked', async () => {
    const l = lead()
    const reply = await run({ kind: 'crew-ask', goal: 'g1', question: 'Should I push?', options: ['Push and open the PR', 'Keep it local'] }, host({}, l))
    expect(reply).toEqual({ ok: true, exit: 0, out: 'Keep it local' })
    expect(l.ask).toHaveBeenCalledWith('g1', 'Should I push?', ['Push and open the PR', 'Keep it local'])
  })

  it('passes on the host refusal, such as a question already open', async () => {
    const l = lead({ ask: vi.fn(async () => ({ ok: false as const, error: 'A question is already waiting for an answer.' })) })
    expect(await run({ kind: 'crew-ask', goal: 'g1', question: 'Q', options: ['a', 'b'] }, host({}, l))).toEqual({ ok: false, exit: 1, out: 'A question is already waiting for an answer.' })
  })

  it('limits the sizes', async () => {
    const h = host()
    expect(await run({ kind: 'crew-ask', goal: 'g1', question: 'x'.repeat(501), options: ['a', 'b'] }, h)).toMatchObject({ ok: false, out: expect.stringContaining('longer than 500') })
    expect(await run({ kind: 'crew-ask', goal: 'g1', question: 'Q', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, h)).toMatchObject({ ok: false, out: 'Give at most 6 options.' })
    expect(await run({ kind: 'crew-ask', goal: 'g1', question: 'Q', options: ['a', 'x'.repeat(81)] }, h)).toMatchObject({ ok: false, out: expect.stringContaining('80 characters') })
  })

  it('posts a note to the goal board', async () => {
    const l = lead()
    expect(await run({ kind: 'crew-note', goal: 'g1', text: 'Omar is on it' }, host({}, l))).toEqual({ ok: true, exit: 0, out: 'noted' })
    expect(l.note).toHaveBeenCalledWith('g1', 'Omar is on it')
    expect(await run({ kind: 'crew-note', goal: 'g1', text: 'x'.repeat(501) }, host({}, l))).toMatchObject({ ok: false })
    expect(await run({ kind: 'crew-note', goal: 'other', text: 'hi' }, host({}, l))).toMatchObject({ ok: false, out: expect.stringContaining('No active goal') })
  })
})

describe('crew run with a goal', () => {
  const runGoal = (over: Partial<Extract<CliCommand, { kind: 'crew-run' }>> = {}, h: CliHost = host()) =>
    run({ kind: 'crew-run', member: 'omar', project: null, path: null, choice: 'default', fields: { task: 'fix' }, background: false, goal: 'g1', ...over }, h)

  it('runs in the goal project without --project and links the run to the goal', async () => {
    const h = host()
    expect(await runGoal({}, h)).toEqual({ ok: true, exit: 0, out: 'k3m9qz' })
    expect(h.crewRun).toHaveBeenCalledWith(expect.objectContaining({ goal: 'g1', project: PROJECTS[0] }))
  })

  it('refuses another project than the goal project', async () => {
    expect(await runGoal({ project: 'billing-api' })).toMatchObject({ ok: false, out: 'Goal g1 is for project acme-web, not billing-api.' })
  })

  it('refuses members the Lead may not use', async () => {
    const h = host({}, lead({}, { excluded: ['omar'] }))
    expect(await runGoal({}, h)).toMatchObject({ ok: false, out: expect.stringContaining('Omar is not one of the members') })
    expect(h.crewRun).not.toHaveBeenCalled()
  })

  it('refuses when "at once" runs are already working', async () => {
    const h = host({}, lead({ load: () => ({ active: 2, spent: 0 }) }))
    expect(await runGoal({}, h)).toMatchObject({ ok: false, out: expect.stringContaining('limit is 2 at once') })
    expect(h.crewRun).not.toHaveBeenCalled()
    const roomy = host({}, lead({ load: () => ({ active: 2, spent: 0 }) }, { atOnce: 3 }))
    expect((await runGoal({}, roomy)).ok).toBe(true)
  })

  it('refuses a run that would pass the budget, using the chosen model for the estimate', async () => {
    const h = host({}, lead({ load: () => ({ active: 0, spent: 2.7 }) }))
    expect(await runGoal({}, h)).toMatchObject({ ok: false, out: expect.stringContaining('over the $3.00 budget') })
    expect(h.crewRun).not.toHaveBeenCalled()
    const cheap = host({}, lead({ load: () => ({ active: 0, spent: 2.7 }) }))
    expect((await runGoal({ choice: 'haiku' }, cheap)).ok).toBe(true)
  })

  it('refuses before the plan is approved when the goal needs one', async () => {
    const waiting = lead({ goal: () => ({ ...GOAL, approved: false }) })
    expect(await runGoal({}, host({}, waiting))).toMatchObject({ ok: false, out: expect.stringContaining('plan is not approved') })
  })

  it('refuses an unknown goal', async () => {
    expect(await runGoal({ goal: 'zzz' })).toMatchObject({ ok: false, out: expect.stringContaining("No active goal 'zzz'") })
  })

  it('does not check anything for a plain run without a goal', async () => {
    const h = host({}, lead({ load: () => ({ active: 9, spent: 99 }) }))
    expect((await run({ kind: 'crew-run', member: 'omar', project: 'acme-web', path: null, choice: 'default', fields: { task: 'x' }, background: false }, h)).ok).toBe(true)
  })
})

describe('a Lead pane is held to its own goal', () => {
  const parseAs = (leadGoal: string | undefined, ...args: string[]) => parseCli(args, 'C:\\work\\acme-web', resolvePath, { leadGoal })
  const RUN = ['crew', 'run', 'omar', '--project', 'acme-web', '--field', 'task=x']

  it('refuses a run without --goal from the Lead', () => {
    expect(parseAs('g1', ...RUN)).toEqual({ ok: false, error: 'The Lead must run members with --goal g1.' })
  })

  it('refuses a run for another goal from the Lead', () => {
    expect(parseAs('g1', ...RUN, '--goal', 'g2')).toEqual({ ok: false, error: 'The Lead must run members with --goal g1.' })
  })

  it('keeps a run that names its own goal', () => {
    expect(parseAs('g1', ...RUN, '--goal', 'g1')).toMatchObject({ ok: true, command: { kind: 'crew-run', goal: 'g1' } })
  })

  it('leaves runs from panes without a goal unrestricted', () => {
    expect(parseAs(undefined, ...RUN)).toMatchObject({ ok: true, command: { kind: 'crew-run' } })
    expect(parseAs('', ...RUN)).toMatchObject({ ok: true, command: { kind: 'crew-run' } })
  })
})
