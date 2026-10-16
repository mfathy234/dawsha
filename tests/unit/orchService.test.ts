import { describe, expect, it } from 'vitest'
import { OrchService } from '../../src/main/orch/service'
import { parseArchive } from '../../src/shared/orch/runArchive'
import { OrchStore } from '../../src/main/orch/store'

function setup() {
  let t = 0
  const svc = new OrchService(new OrchStore(':memory:'), () => (t += 1))
  const run = svc.createRun({ projectPath: 'C:/p', title: 'CSV export', story: 'As a user…', plan: 'Default' })
  const lead = svc.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })
  const impl = svc.registerAgent({ runId: run.id, role: 'implementer', runner: 'codex', model: 'gpt' })
  const rev = svc.registerAgent({ runId: run.id, role: 'code-reviewer', runner: 'claude', model: 'sonnet' })
  return { svc, run, lead, impl, rev }
}

describe('OrchService tasks', () => {
  it('persists optional run overrides, round-trips archives and enforces solo tasks', () => {
    const svc = new OrchService(new OrchStore(':memory:'))
    const run = svc.startRun({ projectPath: 'C:/p', title: 'Solo', story: 's', plan: 'default', leadProfileId: 'p-lead-budget', solo: true })
    expect(svc.run(run.id)).toMatchObject({ leadProfileId: 'p-lead-budget', solo: true })
    const lead = svc.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'sonnet' })
    expect(() => svc.call(lead, 'create_task', { title: 'Delegate', spec: 's', role: 'implementer' })).toThrow(/solo.*self: true/i)
    expect(svc.tasks(run.id)).toHaveLength(0)
    expect(svc.call(lead, 'create_task', { title: 'My work', spec: 's', role: 'implementer', self: true })).toMatchObject({ role: 'lead', assignee: lead.id })
    expect(svc.call(lead, 'set_estimate', { size: 'large', reason: 'Many files' })).toMatchObject({ next: expect.stringContaining('self: true') })
    const archive = svc.exportRun(run.id)
    expect(parseArchive(JSON.stringify(archive)).ok).toBe(true)
    expect(svc.importRun(archive)).toMatchObject({ leadProfileId: 'p-lead-budget', solo: true })
    expect(parseArchive(JSON.stringify({ ...archive, run: { ...archive.run, solo: 'yes' } })).ok).toBe(false)
    const { leadProfileId, solo, ...legacy } = archive.run
    expect(parseArchive(JSON.stringify({ ...archive, run: legacy })).ok).toBe(true)
  })

  it('does not spawn a reviewer for a solo lead task', () => {
    const svc = new OrchService(new OrchStore(':memory:'))
    const run = svc.startRun({ projectPath: 'C:/p', title: 'Solo', story: 's', plan: 'default', solo: true })
    const lead = svc.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })
    expect(() => svc.call(lead, 'create_task', { title: 'Own work', spec: 's', role: 'implementer', self: true, review: true })).toThrow(/solo.*review/i)
    expect(svc.tasks(run.id)).toHaveLength(0)
  })

  it('lets the lead create tasks and a worker claim them in dependency order', () => {
    const { svc, lead, impl } = setup()
    const a = svc.call(lead, 'create_task', { title: 'Query', spec: 's', role: 'implementer', review: true }) as { key: string }
    svc.call(lead, 'create_task', { title: 'Writer', spec: 's', role: 'implementer', review: true, depends_on: [a.key] })
    const mine = svc.call(impl, 'get_my_task', {}) as { key: string; status: string }
    expect(mine).toMatchObject({ key: 'T-1', status: 'in_progress' })
    expect(svc.call(impl, 'get_my_task', {})).toMatchObject({ key: 'T-1' })
  })
  it('refuses tools outside the role', () => {
    const { svc, impl } = setup()
    expect(() => svc.call(impl, 'create_task', { title: 'x', spec: 'y', role: 'ui' })).toThrow(/not allowed/i)
  })
  it('sends finished implementer work to review and runs the reject/approve loop', () => {
    const { svc, lead, impl, rev } = setup()
    svc.call(lead, 'create_task', { title: 'Writer', spec: 's', role: 'implementer', review: true })
    svc.call(impl, 'get_my_task', {})
    svc.call(impl, 'complete_task', { summary: 'done', files: ['a.ts'] })
    const review = svc.call(rev, 'get_my_task', {}) as { key: string; reviewOf: string }
    expect(review.reviewOf).toBe('T-1')
    expect(svc.task('T-1', impl.runId).status).toBe('in_review')
    svc.call(rev, 'submit_review', { verdict: 'reject', comments: 'BOM missing' })
    expect(svc.task('T-1', impl.runId)).toMatchObject({ status: 'in_progress', reviewRound: 1, feedback: 'BOM missing' })
    expect((svc.call(impl, 'fetch_inbox', {}) as { body: string }[])[0].body).toMatch(/BOM missing/)
    svc.call(impl, 'complete_task', { summary: 'fixed' })
    svc.call(rev, 'get_my_task', {})
    svc.call(rev, 'submit_review', { verdict: 'approve', comments: 'ok' })
    expect(svc.task('T-1', impl.runId).status).toBe('approved')
  })
  it('escalates to the human after the second rejection', () => {
    const { svc, lead, impl, rev } = setup()
    svc.call(lead, 'create_task', { title: 'W', spec: 's', role: 'implementer', review: true })
    for (let round = 0; round < 2; round += 1) {
      svc.call(impl, 'get_my_task', {})
      svc.call(impl, 'complete_task', { summary: 'try' })
      svc.call(rev, 'get_my_task', {})
      svc.call(rev, 'submit_review', { verdict: 'reject', comments: `no ${round}` })
    }
    expect(svc.task('T-1', impl.runId).status).toBe('waiting_on_human')
    expect(svc.openDecisions()).toEqual([expect.objectContaining({ kind: 'escalation' })])
  })
})
