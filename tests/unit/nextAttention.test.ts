import { describe, expect, it } from 'vitest'
import { nextAttentionPane } from '../../src/shared/attention'

describe('nextAttentionPane', () => {
  const order = ['a', 'b', 'c', 'd']

  it('prefers a pane waiting on a prompt over one that is done, starting after the focused pane', () => {
    expect(nextAttentionPane(order, 'b', { a: 'needs', c: 'done', d: 'needs' })).toBe('d')
    expect(nextAttentionPane(order, 'd', { a: 'needs', c: 'done', d: 'needs' })).toBe('a')
    expect(nextAttentionPane(order, 'a', { c: 'done', d: 'none' })).toBe('c')
  })

  it('returns the focused pane only when it is the one needing attention, and null when none do', () => {
    expect(nextAttentionPane(order, 'b', { b: 'needs' })).toBe('b')
    expect(nextAttentionPane(order, 'b', { a: 'none' })).toBeNull()
    expect(nextAttentionPane(order, null, { c: 'done' })).toBe('c')
    expect(nextAttentionPane([], null, {})).toBeNull()
  })

  it('cycles through every pane that needs you, in pane order, and wraps around', () => {
    const needs = { a: 'needs', c: 'needs', d: 'needs' } as const
    const visited: (string | null)[] = []
    let at: string | null = 'b'
    for (let i = 0; i < 5; i += 1) {
      at = nextAttentionPane(order, at, needs)
      visited.push(at)
    }
    expect(visited).toEqual(['c', 'd', 'a', 'c', 'd'])
  })

  it('keeps jumping between needs-you panes before it visits a finished one', () => {
    const mixed = { a: 'done', b: 'needs', d: 'needs' } as const
    expect(nextAttentionPane(order, 'b', mixed)).toBe('d')
    expect(nextAttentionPane(order, 'd', mixed)).toBe('b')
  })
})
