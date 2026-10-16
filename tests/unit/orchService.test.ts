import { describe, expect, it } from 'vitest'
import { OrchService } from '../../src/main/orch/service'
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
  it('lets the lead create tasks and a worker claim them in dependency order', () => {
    const { svc, lead, impl } = setup()
    const a = svc.call(lead, 'create_task', { title: 'Query', spec: 's', role: 'implementer' }) as { key: string }
    svc.call(lead, 'create_task', { title: 'Writer', spec: 's', role: 'implementer', depends_on: [a.key] })
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
    svc.call(lead, 'create_task', { title: 'Writer', spec: 's', role: 'implementer' })
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
    svc.call(lead, 'create_task', { title: 'W', spec: 's', role: 'implementer' })
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
