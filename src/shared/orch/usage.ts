import type { AgentUsage, OrchAgent, OrchRole } from './types'

/** USD per million tokens. Cache prices fall back to the input price when not set. */
export interface ModelPrice {
  inputPerM: number
  outputPerM: number
  cacheReadPerM?: number
  cacheWritePerM?: number
}

/** 'free' for local models; null when the user has not set a price for this model. */
export type PriceLookup = (runner: string, model: string) => ModelPrice | 'free' | null

/** reported: from the CLI; estimated: tokens x price; free: local; unpriced: no price set; none: no usage yet. */
export type CostSource = 'reported' | 'estimated' | 'free' | 'unpriced' | 'none'

export interface TokenTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
}

export interface AgentCost extends TokenTotals {
  agentId: string
  role: OrchRole
  runner: string
  model: string
  costUsd: number | null
  costSource: CostSource
}

export interface RoleCost {
  role: OrchRole
  agents: number
  totalTokens: number
  costUsd: number
}

export interface RunUsage {
  agents: AgentCost[]
  byRole: RoleCost[]
  /** costUsd sums every known cost; complete is false when some agent has no price. */
  total: TokenTotals & { costUsd: number; complete: boolean }
}

const PER_MILLION = 1_000_000
const NO_USAGE: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reportedCostUsd: null }

export function estimateCost(usage: AgentUsage, price: ModelPrice): number {
  return (
    usage.inputTokens * price.inputPerM +
    usage.outputTokens * price.outputPerM +
    usage.cacheReadTokens * (price.cacheReadPerM ?? price.inputPerM) +
    usage.cacheWriteTokens * (price.cacheWritePerM ?? price.inputPerM)
  ) / PER_MILLION
}

function tokenTotals(usage: AgentUsage): TokenTotals {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = usage
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens }
}

function costOf(agent: OrchAgent, prices: PriceLookup): Pick<AgentCost, 'costUsd' | 'costSource'> {
  if (!agent.usage) return { costUsd: 0, costSource: 'none' }
  if (agent.usage.reportedCostUsd !== null) return { costUsd: agent.usage.reportedCostUsd, costSource: 'reported' }
  const price = prices(agent.runner, agent.model)
  if (price === 'free') return { costUsd: 0, costSource: 'free' }
  if (!price) return { costUsd: null, costSource: 'unpriced' }
  return { costUsd: estimateCost(agent.usage, price), costSource: 'estimated' }
}

export function summarizeRunUsage(agents: readonly OrchAgent[], prices: PriceLookup): RunUsage {
  const rows: AgentCost[] = agents.map((agent) => ({
    agentId: agent.id,
    role: agent.role,
    runner: agent.runner,
    model: agent.model,
    ...tokenTotals(agent.usage ?? NO_USAGE),
    ...costOf(agent, prices)
  }))
  const sum = (pick: (row: AgentCost) => number): number => rows.reduce((total, row) => total + pick(row), 0)
  const byRole = [...new Set(rows.map((row) => row.role))].map((role) => {
    const mine = rows.filter((row) => row.role === role)
    return {
      role,
      agents: mine.length,
      totalTokens: mine.reduce((total, row) => total + row.totalTokens, 0),
      costUsd: mine.reduce((total, row) => total + (row.costUsd ?? 0), 0)
    }
  })
  return {
    agents: rows,
    byRole,
    total: {
      inputTokens: sum((row) => row.inputTokens),
      outputTokens: sum((row) => row.outputTokens),
      cacheReadTokens: sum((row) => row.cacheReadTokens),
      cacheWriteTokens: sum((row) => row.cacheWriteTokens),
      totalTokens: sum((row) => row.totalTokens),
      costUsd: sum((row) => row.costUsd ?? 0),
      complete: rows.every((row) => row.costSource !== 'unpriced')
    }
  }
}
