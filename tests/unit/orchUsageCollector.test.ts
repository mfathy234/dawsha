import { describe, expect, it } from 'vitest'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'
import { OrchUsageCollector, type UsageFinder } from '../../src/main/orch/usageCollector'

const claudeLine = (id: string, input: number, output: number): string =>
  JSON.stringify({ type: 'assistant', requestId: id, message: { id, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } } })

describe('orchestrator usage collector', () => {
  it('reports each agent transcript tokens and the cost Claude reported', async () => {
    const svc = new OrchService(new OrchStore(':memory:'))
    const run = svc.startRun({ kind: 'bug', projectPath: 'C:/p', title: 'x', story: 's', plan: 'default' })
    const agent = svc.registerAgent({ runId: run.id, role: 'fixer', runner: 'claude', model: 'opus' })
    const files: Record<string, string> = { 'C:/t/s-1.jsonl': [claudeLine('m1', 100, 20), claudeLine('m2', 50, 30)].join('\n') }
    let finds = 0
    const finder: UsageFinder = {
      find: async () => {
        finds += 1
        return 'C:/t/s-1.jsonl'
      },
      read: async (path) => files[path]
    }
    const collector = new OrchUsageCollector(finder)
    collector.setReportedCost('s-1', 0.42)
    const source = { agentId: agent.id, runner: 'claude' as const, cwd: 'C:/wt', sessionId: 's-1', startedAt: 0 }
    await collector.collect(svc, [source])
    expect(svc.agent(agent.id)?.usage).toEqual({ inputTokens: 150, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 10, reportedCostUsd: 0.42 })
    await collector.collect(svc, [source])
    expect(finds).toBe(1)
  })

  it('skips agents whose transcript is not there yet', async () => {
    const svc = new OrchService(new OrchStore(':memory:'))
    const run = svc.startRun({ kind: 'bug', projectPath: 'C:/p', title: 'x', story: 's', plan: 'default' })
    const agent = svc.registerAgent({ runId: run.id, role: 'fixer', runner: 'codex', model: 'gpt' })
    const collector = new OrchUsageCollector({ find: async () => null, read: async () => '' })
    await collector.collect(svc, [{ agentId: agent.id, runner: 'codex', cwd: 'C:/wt', sessionId: null, startedAt: 0 }])
    expect(svc.agent(agent.id)?.usage).toBeNull()
  })
})
