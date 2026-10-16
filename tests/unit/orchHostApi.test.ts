import { describe, expect, it } from 'vitest'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'

function setup(extra: Partial<Parameters<OrchService['startRun']>[0]> = {}) {
  let t = 0
  const svc = new OrchService(new OrchStore(':memory:'), () => (t += 1))
  const changes: number[] = []
  svc.onChange(() => changes.push(t))
  const run = svc.startRun({ projectPath: 'C:/work/dawsha', projectId: 'proj-1', title: 'CSV export', story: 'As a user I want a CSV.', plan: 'default', ...extra })
  return { svc, run, changes }
}

describe('orchestrator host API for the dispatcher', () => {
  it('starts a feature run with a spec task made from the story and remembers its project', () => {
    const { svc, run } = setup()
    expect(run).toMatchObject({ kind: 'feature', stage: 'spec', projectId: 'proj-1', specApproval: true })
    expect(svc.task('T-1', run.id)).toMatchObject({ role: 'spec-writer', status: 'todo', spec: expect.stringContaining('As a user I want a CSV.') })
    expect(svc.runs().map((r) => r.id)).toEqual([run.id])
  })

  it('approves the spec without asking when the plan has no spec stop', () => {
    const { svc, run } = setup({ specApproval: false })
    const writer = svc.registerAgent({ runId: run.id, role: 'spec-writer', runner: 'claude', model: 'sonnet' })
    svc.call(writer, 'get_my_task', {})
    svc.call(writer, 'complete_task', { summary: 'spec v1' })
    expect(svc.task('T-1', run.id).status).toBe('approved')
    expect(svc.openDecisions()).toEqual([])
  })

  it('notifies listeners once per finished change, not for failed ones', () => {
    const { svc, run, changes } = setup()
    const before = changes.length
    expect(before).toBe(1)
    const agent = svc.registerAgent({ runId: run.id, role: 'spec-writer', runner: 'claude', model: 'sonnet' })
    expect(changes.length).toBe(2)
    expect(() => svc.call(agent, 'complete_task', { summary: 'x' })).toThrow()
    expect(changes.length).toBe(2)
  })

  it('assigns a task to a specific agent, which then gets it from get_my_task', () => {
    const { svc, run } = setup()
    const writer = svc.registerAgent({ runId: run.id, role: 'spec-writer', runner: 'claude', model: 'sonnet' })
    svc.assignTask(run.id, 'T-1', writer.id)
    expect(svc.task('T-1', run.id)).toMatchObject({ status: 'assigned', assignee: writer.id })
    expect(svc.call(writer, 'get_my_task', {})).toMatchObject({ key: 'T-1', status: 'in_progress' })
  })

  it('stores launch settings and gives a fresh token on every spawn, retiring the old one', () => {
    const { svc, run } = setup()
    const agent = svc.registerAgent({ runId: run.id, role: 'spec-writer', runner: 'claude', model: 'sonnet' })
    svc.setLaunch(agent.id, { agent: 'claude', args: ['--model', 'sonnet'], env: {}, files: [] })
    expect(svc.agent(agent.id)?.launch?.args).toEqual(['--model', 'sonnet'])
    const fresh = svc.rotateToken(agent.id)
    expect(fresh).not.toBe(agent.token)
    expect(svc.agentForToken(agent.token)).toBeUndefined()
    expect(svc.agentForToken(fresh)?.id).toBe(agent.id)
  })

  it('puts a task back in the queue when its pane dies, and asks the human after a second failure', () => {
    const { svc, run } = setup()
    const first = svc.registerAgent({ runId: run.id, role: 'spec-writer', runner: 'claude', model: 'sonnet' })
    svc.assignTask(run.id, 'T-1', first.id)
    svc.releaseAgent(first.id, 'The Claude pane closed')
    expect(svc.task('T-1', run.id)).toMatchObject({ status: 'todo', assignee: null, attempts: 1 })
    expect(svc.agent(first.id)?.retiredAt).not.toBeNull()
    const second = svc.registerAgent({ runId: run.id, role: 'spec-writer', runner: 'claude', model: 'sonnet' })
    svc.assignTask(run.id, 'T-1', second.id)
    svc.releaseAgent(second.id, 'The Claude pane closed again')
    expect(svc.task('T-1', run.id).status).toBe('blocked')
    expect(svc.openDecisions()).toEqual([expect.objectContaining({ kind: 'stall', question: expect.stringContaining('closed again') })])
  })

  it('reports a quota hit as a stall decision offering other models, and resumes on "Wait"', () => {
    const { svc, run } = setup()
    const writer = svc.registerAgent({ runId: run.id, role: 'spec-writer', runner: 'claude', model: 'sonnet' })
    svc.assignTask(run.id, 'T-1', writer.id)
    svc.call(writer, 'get_my_task', {})
    const decision = svc.reportStall(writer.id, 'Claude usage limit reached. Resets at 5pm.', ['Codex', 'Gemini', 'Wait'])
    expect(svc.task('T-1', run.id).status).toBe('stalled')
    expect(decision).toMatchObject({ kind: 'stall', options: ['Codex', 'Gemini', 'Wait'] })
    expect(svc.reportStall(writer.id, 'again', ['Wait']).id).toBe(decision.id)
    svc.answerDecision(decision.id, 'Wait')
    expect(svc.task('T-1', run.id).status).toBe('in_progress')
  })

  it('moves the run through its stages and records merged tasks', () => {
    const { svc, run } = setup()
    svc.setStage(run.id, 'build')
    expect(svc.run(run.id)?.stage).toBe('build')
    svc.markMerged(run.id, 'T-1')
    expect(svc.task('T-1', run.id).mergedAt).not.toBeNull()
  })
})
