import { describe, expect, it } from 'vitest'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'

function setup() {
  let t = 0
  const svc = new OrchService(new OrchStore(':memory:'), () => (t += 1))
  const run = svc.createRun({ kind: 'bug', projectPath: 'C:/work/dawsha', title: 'Export button does nothing', story: 'Clicking Export CSV with an empty range throws.', plan: 'Default' })
  return { svc, run }
}

describe('bug runs', () => {
  it('start straight in build with one fixer task made from the report', () => {
    const { svc, run } = setup()
    expect(run).toMatchObject({ kind: 'bug', stage: 'build' })
    expect(svc.task('T-1', run.id)).toMatchObject({ role: 'fixer', status: 'todo', title: 'Export button does nothing', spec: expect.stringContaining('empty range throws') })
  })

  it('use a single fixer agent: no lead, reviewers or other subagents', () => {
    const { svc, run } = setup()
    expect(() => svc.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })).toThrow(/bug runs use one fixer/i)
    expect(() => svc.registerAgent({ runId: run.id, role: 'code-reviewer', runner: 'codex', model: 'gpt' })).toThrow(/bug runs use one fixer/i)
    const fixer = svc.registerAgent({ runId: run.id, role: 'fixer', runner: 'claude', model: 'opus' })
    expect(() => svc.registerAgent({ runId: run.id, role: 'fixer', runner: 'codex', model: 'gpt' })).toThrow(/already has a fixer/i)
    expect(svc.call(fixer, 'get_my_task', {})).toMatchObject({ key: 'T-1', status: 'in_progress' })
    expect(svc.call(fixer, 'complete_task', { summary: 'Guarded the empty range', files: ['UsageExport.ts'] })).toMatchObject({ status: 'approved' })
    expect(svc.tasks(run.id)).toHaveLength(1)
  })

  it('can still ask the human and be continued on another model', () => {
    const { svc, run } = setup()
    const fixer = svc.registerAgent({ runId: run.id, role: 'fixer', runner: 'claude', model: 'opus' })
    svc.call(fixer, 'get_my_task', {})
    svc.call(fixer, 'ask_human', { question: 'Disable the button or show a message?' })
    expect(svc.task('T-1', run.id).status).toBe('waiting_on_human')
    svc.answerDecision(svc.openDecisions()[0].id, 'Show a message')
    const { agent } = svc.handoffTask(run.id, 'T-1', { runner: 'codex', model: 'gpt-codex', note: 'Claude quota ran out' })
    expect(agent.role).toBe('fixer')
    expect(svc.call(agent, 'get_my_task', {})).toMatchObject({ key: 'T-1' })
  })

  it('reports token usage and estimated cost for the run', () => {
    const { svc, run } = setup()
    const fixer = svc.registerAgent({ runId: run.id, role: 'fixer', runner: 'codex', model: 'gpt' })
    svc.reportUsage(fixer.id, { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, reportedCostUsd: null })
    const usage = svc.runUsage(run.id, () => ({ inputPerM: 2, outputPerM: 10 }))
    expect(usage.total).toMatchObject({ totalTokens: 1_100_000, complete: true })
    expect(usage.total.costUsd).toBeCloseTo(3)
    expect(usage.agents).toEqual([expect.objectContaining({ role: 'fixer', model: 'gpt', costSource: 'estimated' })])
  })
})
