import { describe, expect, it } from 'vitest'
import { allFolded, allOpen, defaultOpen, groupSummary, isGroupOpen, parseFolds, setAllFolds, setFold, summaryText, MAX_FOLDS } from '../../src/shared/agentFolds'

const group = (sessionKey: string, running: number, done: number, failed: number) => ({
  sessionKey, running, done, failed, agents: Array.from({ length: running + done + failed }, () => ({}) as never)
})

describe('agent group folds', () => {
  it('opens groups with a running or failed agent and folds finished-only groups by default', () => {
    expect(defaultOpen(group('a', 3, 0, 0))).toBe(true)
    expect(defaultOpen(group('b', 0, 1, 1))).toBe(true)
    expect(defaultOpen(group('c', 0, 31, 0))).toBe(false)
  })

  it('lets a remembered choice win over the default, either way', () => {
    const finished = group('fin', 0, 4, 0)
    const busy = group('busy', 1, 0, 0)
    expect(isGroupOpen(finished, { fin: true })).toBe(true)
    expect(isGroupOpen(busy, { busy: false })).toBe(false)
    expect(isGroupOpen(finished, {})).toBe(false)
  })

  it('writes the one-line summary and marks only the failed count as needing you', () => {
    expect(summaryText(group('x', 0, 31, 0))).toBe('31 agents · 31 done')
    expect(summaryText(group('x', 3, 0, 0))).toBe('3 agents · 3 running')
    expect(summaryText(group('x', 0, 1, 1))).toBe('2 agents · 1 failed · 1 done')
    expect(summaryText(group('x', 0, 1, 0))).toBe('1 agent · 1 done')
    expect(groupSummary(group('x', 0, 1, 1)).map((part) => part.tone)).toEqual(['plain', 'needs', 'plain'])
  })

  it('returns new maps and keeps earlier choices', () => {
    const base = { a: true }
    const next = setFold(base, 'b', false)
    expect(base).toEqual({ a: true })
    expect(next).toEqual({ a: true, b: false })
    expect(setFold(next, 'a', false)).toEqual({ b: false, a: false })
  })

  it('expands or collapses every group shown without forgetting groups that are filtered out', () => {
    const shown = [group('a', 1, 0, 0), group('b', 0, 2, 0)]
    const folds = setAllFolds({ hidden: true }, shown, false)
    expect(folds).toEqual({ hidden: true, a: false, b: false })
    expect(allFolded(shown, folds)).toBe(true)
    expect(allOpen(shown, setAllFolds(folds, shown, true))).toBe(true)
  })

  it('caps the remembered choices and reads stored text defensively', () => {
    let folds = {}
    for (let i = 0; i < MAX_FOLDS + 20; i += 1) folds = setFold(folds, `k${i}`, true)
    expect(Object.keys(folds)).toHaveLength(MAX_FOLDS)
    expect('k0' in folds).toBe(false)
    expect(parseFolds('{"a":true,"b":"no","c":false}')).toEqual({ a: true, c: false })
    expect(parseFolds('not json')).toEqual({})
    expect(parseFolds('[1]')).toEqual({})
    expect(parseFolds(null)).toEqual({})
  })
})
