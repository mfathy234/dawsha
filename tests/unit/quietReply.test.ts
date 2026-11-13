import { describe, expect, it } from 'vitest'
import { lastReplySummary, lastReplyWords, planBadge } from '../../src/shared/quietReply'
import type { TurnSummary } from '../../src/shared/turnSummary'

const summary = (messageId: string, files: number): TurnSummary => ({
  messageId,
  files: Array.from({ length: files }, (_, index) => ({ path: `f${index}.ts`, status: 'M' as const, added: 1, removed: 0 })),
  added: files,
  removed: 0
})

describe('quiet reply line', () => {
  it('says how many files the last reply edited', () => {
    expect(lastReplyWords(summary('a', 3))).toBe('Last reply edited 3 files')
    expect(lastReplyWords(summary('a', 1))).toBe('Last reply edited 1 file')
  })

  it('only sums up the very last reply', () => {
    const all = [summary('a', 2), summary('b', 1)]
    expect(lastReplySummary(all, 'b')?.messageId).toBe('b')
    expect(lastReplySummary(all, 'c')).toBeNull()
    expect(lastReplySummary(all, null)).toBeNull()
  })

  it('turns the plan note into the header count', () => {
    expect(planBadge('5 of 7')).toEqual({ count: '5/7', percent: 71 })
    expect(planBadge('')).toBeNull()
    expect(planBadge('0 of 0')).toBeNull()
  })
})
