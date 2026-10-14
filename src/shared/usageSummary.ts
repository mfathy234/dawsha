import { AGENTS } from './agents'
import type { UsageBucket, UsageRange, UsageReport } from './usage'

export interface UsageTotals {
  costUsd: number | null
  tokens: number
  cacheRead: number
  sessions: number
}

export interface Busiest {
  key: string
  tokens: number
}

const bucketTokens = (bucket: UsageBucket): number => AGENTS.reduce((sum, agent) => sum + bucket.perAgent[agent].tokens, 0)

function bucketCost(bucket: UsageBucket): number | null {
  let total: number | null = null
  for (const agent of AGENTS) {
    const cost = bucket.perAgent[agent].costUsd
    if (cost !== null) total = (total ?? 0) + cost
  }
  return total
}

export function totalsOf(report: UsageReport): UsageTotals {
  let costUsd: number | null = null
  for (const bucket of report.buckets) {
    const cost = bucketCost(bucket)
    if (cost !== null) costUsd = (costUsd ?? 0) + cost
  }
  return {
    costUsd,
    tokens: report.byAgent.reduce((sum, row) => sum + row.tokens, 0),
    cacheRead: report.byAgent.reduce((sum, row) => sum + row.cacheRead, 0),
    sessions: report.byAgent.reduce((sum, row) => sum + row.sessions, 0)
  }
}

export function busiestBucket(report: UsageReport): Busiest | null {
  let best: Busiest | null = null
  for (const bucket of report.buckets) {
    const tokens = bucketTokens(bucket)
    if (tokens > 0 && (best === null || tokens > best.tokens)) best = { key: bucket.key, tokens }
  }
  return best
}

export function previousTotals(range: UsageRange, longer: UsageReport | null): UsageTotals | null {
  if (range !== '7d' || !longer || longer.range !== '30d' || longer.buckets.length < 14) return null
  const previous = longer.buckets.slice(longer.buckets.length - 14, longer.buckets.length - 7)
  let costUsd: number | null = null
  let tokens = 0
  for (const bucket of previous) {
    tokens += bucketTokens(bucket)
    const cost = bucketCost(bucket)
    if (cost !== null) costUsd = (costUsd ?? 0) + cost
  }
  return { costUsd, tokens, cacheRead: 0, sessions: 0 }
}

export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

export function changeText(change: number | null): string | null {
  if (change === null) return null
  if (change === 0) return 'Same as the previous 7 days'
  return `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)}% vs the previous 7 days`
}

export type SortDirection = 'asc' | 'desc'

export interface SortState<K extends string> {
  key: K
  direction: SortDirection
}

export function nextSort<K extends string>(current: SortState<K>, key: K, textKeys: readonly K[] = []): SortState<K> {
  if (current.key === key) return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
  return { key, direction: textKeys.includes(key) ? 'asc' : 'desc' }
}

export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: SortState<K>,
  value: (row: T, key: K) => string | number | null
): T[] {
  const factor = sort.direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const left = value(a, sort.key)
    const right = value(b, sort.key)
    if (left === right) return 0
    if (left === null) return 1
    if (right === null) return -1
    if (typeof left === 'string' && typeof right === 'string') return left.localeCompare(right) * factor
    return ((left as number) - (right as number)) * factor
  })
}
