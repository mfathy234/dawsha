import { describe, expect, it } from 'vitest'
import { estimateCost, summarizeRunUsage, type PriceLookup } from '../../src/shared/orch/usage'
import type { OrchAgent } from '../../src/shared/orch/types'

const agent = (over: Partial<OrchAgent>): OrchAgent => ({
  id: 'a', runId: 'r', role: 'implementer', runner: 'codex', model: 'gpt', token: 't', taskId: null, createdAt: 1, usage: null, ...over
})

const prices: PriceLookup = (runner, model) => {
  if (runner === 'opencode') return 'free'
  if (model === 'gpt') return { inputPerM: 2, outputPerM: 8, cacheReadPerM: 0.5 }
  return null
}

describe('orchestrator usage and cost', () => {
  it('estimates cost from tokens and per-million prices', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 0, reportedCostUsd: null }
    expect(estimateCost(usage, { inputPerM: 2, outputPerM: 8, cacheReadPerM: 0.5 })).toBeCloseTo(2 + 4 + 1)
    expect(estimateCost(usage, { inputPerM: 2, outputPerM: 8 })).toBeCloseTo(2 + 4 + 4)
  })

  it('summarises a run per agent and in total, labelling where each cost came from', () => {
    const summary = summarizeRunUsage([
      agent({ id: 'lead', role: 'lead', runner: 'claude', model: 'opus', usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000, cacheWriteTokens: 10, reportedCostUsd: 0.61 } }),
      agent({ id: 'impl', usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reportedCostUsd: null } }),
      agent({ id: 'ux', role: 'ux-reviewer', runner: 'opencode', model: 'qwen', usage: { inputTokens: 500, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, reportedCostUsd: null } }),
      agent({ id: 'gem', role: 'tester', runner: 'gemini', model: 'flash', usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, reportedCostUsd: null } }),
      agent({ id: 'idle', role: 'ui', usage: null })
    ], prices)
    expect(summary.agents.map((a) => [a.agentId, a.costSource, a.costUsd])).toEqual([
      ['lead', 'reported', 0.61],
      ['impl', 'estimated', 2],
      ['ux', 'free', 0],
      ['gem', 'unpriced', null],
      ['idle', 'none', 0]
    ])
    expect(summary.agents[0]).toMatchObject({ role: 'lead', runner: 'claude', model: 'opus', totalTokens: 1160 })
    expect(summary.total).toMatchObject({ inputTokens: 1_000_610, outputTokens: 560, totalTokens: 1_002_180 })
    expect(summary.total.costUsd).toBeCloseTo(2.61)
    expect(summary.total.complete).toBe(false)
    expect(summary.byRole.find((r) => r.role === 'implementer')?.costUsd).toBeCloseTo(2)
  })
})
