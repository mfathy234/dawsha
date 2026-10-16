import { describe, expect, it } from 'vitest'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'

function setup() {
  let t = 0
  const svc = new OrchService(new OrchStore(':memory:'), () => (t += 1))
  const run = svc.createRun({ projectPath: 'C:/work/dawsha', title: 'Export usage as CSV', story: 'As a user I want a CSV.', plan: 'Default' })
  const lead = svc.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })
  const impl = svc.registerAgent({ runId: run.id, role: 'implementer', runner: 'codex', model: 'gpt-codex' })
  const rev = svc.registerAgent({ runId: run.id, role: 'code-reviewer', runner: 'claude', model: 'sonnet' })
  svc.call(lead, 'create_task', { title: 'CSV writer', spec: 'Write the CSV writer.', role: 'implementer', acceptance: ['UTF-8 BOM'] })
  svc.call(impl, 'get_my_task', {})
  svc.call(impl, 'update_task', { progress: 'Writer done, tests next.' })
  svc.call(impl, 'put_note', { key: 'encoding', text: 'Always UTF-8 with BOM' })
  return { svc, run, lead, impl, rev }
}

describe('task export and handoff', () => {
  it('exports the current state of a task with its progress, notes and a brief', () => {
    const { svc, run } = setup()
    const state = svc.exportTaskState(run.id, 'T-1')
    expect(state.task).toMatchObject({ key: 'T-1', status: 'in_progress', title: 'CSV writer' })
    expect(state.run).toMatchObject({ title: 'Export usage as CSV', projectPath: 'C:/work/dawsha' })
    expect(state.agent).toMatchObject({ role: 'implementer', runner: 'codex', model: 'gpt-codex' })
    expect(state.progress.join('\n')).toContain('Writer done, tests next.')
    expect(state.notes).toEqual([expect.objectContaining({ key: 'encoding' })])
    expect(state.brief).toContain('# Continue task T-1: CSV writer')
    expect(state.brief).toContain('UTF-8 BOM')
    expect(state.brief).toContain('Writer done, tests next.')
  })

  it('hands an in-progress task to a new model that continues it', () => {
    const { svc, run, impl } = setup()
    const { agent } = svc.handoffTask(run.id, 'T-1', { runner: 'claude', model: 'sonnet', note: 'Codex ran out of quota.' })
    expect(agent).toMatchObject({ role: 'implementer', runner: 'claude', model: 'sonnet' })
    expect(() => svc.call(impl, 'get_my_task', {})).toThrow(/replaced/)
    expect(svc.agentForToken(impl.token)).toBeUndefined()
    expect(svc.call(agent, 'get_my_task', {})).toMatchObject({ key: 'T-1', status: 'in_progress' })
    const inbox = svc.call(agent, 'fetch_inbox', {}) as { body: string }[]
    expect(inbox[0].body).toContain('Writer done, tests next.')
    expect(inbox[0].body).toContain('Codex ran out of quota.')
    expect(svc.events(run.id).at(-1)?.text).toMatch(/T-1 handed over from codex · gpt-codex to claude · sonnet/)
  })

  it('keeps the review round and feedback, and sends review results to the new agent', () => {
    const { svc, run, impl, rev } = setup()
    svc.call(impl, 'complete_task', { summary: 'v1' })
    svc.call(rev, 'get_my_task', {})
    svc.call(rev, 'submit_review', { verdict: 'reject', comments: 'BOM missing' })
    const { agent } = svc.handoffTask(run.id, 'T-1', { runner: 'gemini', model: 'pro' })
    expect(svc.call(agent, 'get_my_task', {})).toMatchObject({ key: 'T-1', reviewRound: 1, feedback: 'BOM missing' })
    svc.call(agent, 'fetch_inbox', {})
    svc.call(agent, 'complete_task', { summary: 'v2' })
    svc.call(rev, 'get_my_task', {})
    svc.call(rev, 'submit_review', { verdict: 'reject', comments: 'still wrong' })
    expect(svc.task('T-1', run.id).assignee).toBe(agent.id)
  })

  it('refuses to hand over finished tasks', () => {
    const { svc, run, impl, rev } = setup()
    svc.call(impl, 'complete_task', { summary: 'v1' })
    svc.call(rev, 'get_my_task', {})
    svc.call(rev, 'submit_review', { verdict: 'approve', comments: 'ok' })
    expect(() => svc.handoffTask(run.id, 'T-1', { runner: 'claude', model: 'sonnet' })).toThrow(/approved/)
  })
})
