import { describe, expect, it } from 'vitest'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'

function setup() {
  let t = 0
  const svc = new OrchService(new OrchStore(':memory:'), () => (t += 1))
  const run = svc.createRun({ projectPath: 'C:/p', title: 'x', story: 's', plan: 'Default' })
  const lead = svc.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })
  const impl = svc.registerAgent({ runId: run.id, role: 'implementer', runner: 'codex', model: 'gpt' })
  const spec = svc.registerAgent({ runId: run.id, role: 'spec-writer', runner: 'claude', model: 'sonnet' })
  return { svc, run, lead, impl, spec }
}

describe('human decisions', () => {
  it('pauses the task on ask_human and resumes it with the answer', () => {
    const { svc, lead, impl } = setup()
    svc.call(lead, 'create_task', { title: 'Cost', spec: 's', role: 'implementer' })
    svc.call(impl, 'get_my_task', {})
    const asked = svc.call(impl, 'ask_human', { question: 'Price others?', options: ['Yes', 'No'], recommended: 0 }) as { decision_id: string }
    expect(svc.task('T-1', impl.runId).status).toBe('waiting_on_human')
    svc.answerDecision(asked.decision_id, 'Yes, mark estimated')
    expect(svc.task('T-1', impl.runId).status).toBe('in_progress')
    expect((svc.call(impl, 'fetch_inbox', {}) as { body: string }[])[0].body).toMatch(/Yes, mark estimated/)
    expect((svc.call(impl, 'get_notes', {}) as { key: string }[]).map((n) => n.key)).toContain(`decision:${asked.decision_id}`)
  })
  it('turns a finished spec into a spec-approval decision', () => {
    const { svc, lead, spec } = setup()
    svc.call(lead, 'create_task', { title: 'Spec', spec: 'story', role: 'spec-writer' })
    svc.call(spec, 'get_my_task', {})
    svc.call(spec, 'complete_task', { summary: 'spec v1', files: ['spec.md'] })
    const [d] = svc.openDecisions()
    expect(d.kind).toBe('spec-approval')
    svc.answerDecision(d.id, 'Add totals per project')
    expect(svc.task('T-1', spec.runId)).toMatchObject({ status: 'in_progress', feedback: 'Add totals per project' })
    svc.call(spec, 'complete_task', { summary: 'spec v2' })
    svc.answerDecision(svc.openDecisions()[0].id, 'Approve')
    expect(svc.task('T-1', spec.runId).status).toBe('approved')
  })
  it('never lets an agent answer a decision', () => {
    const { svc } = setup()
    expect(svc.openDecisions()).toEqual([])
    expect(() => svc.answerDecision('missing', 'x')).toThrow(/not found/i)
  })
})
