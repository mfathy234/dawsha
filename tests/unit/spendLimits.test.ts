import { describe, expect, it } from 'vitest'
import { detectSpendWarnings, formatLimitUsd, limitReached, parseLimitAmount, spendMessage, spendPeriodKey, spendProjects, spendTotals } from '../../src/shared/spendLimits'
import type { SpendProject } from '../../src/shared/spendLimits'

const project: SpendProject = { id: 'p1', folder: 'C:/work/app', limit: { amountUsd: 20, period: 'day' } }
const now = new Date(2026, 10, 8, 12).getTime()

describe('spend limits', () => {
  it('uses calendar day and Monday based week windows', () => {
    expect(spendPeriodKey(now, 'day')).toBe('2026-11-08')
    expect(spendPeriodKey(now, 'week')).toBe('2026-11-02')
  })
  it('totals known costs for the matching project and window only', () => {
    const result = spendTotals([project], [
      { at: now, usd: 16, cwd: 'c:/WORK/app/src' },
      { at: now, usd: 3, cwd: 'C:/work/other' },
      { at: now - 86_400_000, usd: 9, cwd: project.folder }
    ], now)
    expect(result).toEqual({ p1: 16 })
  })
  it('crosses 80 and 100 once per period', () => {
    const first = detectSpendWarnings([project], { p1: 21 }, now, {})
    expect(first.fire.map((warning) => warning.threshold)).toEqual([80, 100])
    expect(detectSpendWarnings([project], { p1: 21 }, now, first.warned).fire).toEqual([])
  })
})

describe('spend limit helpers', () => {
  const stored = { p1: { amountUsd: 20, period: 'day' as const }, gone: { amountUsd: 5, period: 'week' as const } }
  it('pairs stored limits with the projects that still exist', () => {
    const result = spendProjects([{ id: 'p1', folder: 'C:/a' }, { id: 'p2', folder: 'C:/b' }], stored)
    expect(result).toEqual([{ id: 'p1', folder: 'C:/a', limit: stored.p1 }])
  })
  it('words the notifications', () => {
    const base = { projectId: 'p1', spentUsd: 16, limit: stored.p1, periodKey: 'k' }
    expect(spendMessage({ ...base, threshold: 80 }, 'dawsha')).toBe('dawsha has used $16 of its $20 daily limit')
    expect(spendMessage({ ...base, threshold: 100, spentUsd: 20.5, limit: { amountUsd: 20, period: 'week' } }, 'dawsha')).toBe('dawsha has reached its $20 weekly limit ($20.50 used)')
  })
  it('reads an amount typed in the dialog', () => {
    expect(parseLimitAmount('20')).toBe(20)
    expect(parseLimitAmount(' $12.5 ')).toBe(12.5)
    for (const bad of ['', 'abc', '0', '-3', '1e9', '1,5']) expect(parseLimitAmount(bad)).toBeNull()
  })
  it('formats dollars without needless cents', () => {
    expect(formatLimitUsd(20)).toBe('$20')
    expect(formatLimitUsd(12.5)).toBe('$12.50')
  })
  it('flags projects at or over their limit', () => {
    const projects = spendProjects([{ id: 'p1', folder: 'C:/a' }], stored)
    expect(limitReached(projects, { p1: 20 })).toEqual(['p1'])
    expect(limitReached(projects, { p1: 19.99 })).toEqual([])
  })
})
