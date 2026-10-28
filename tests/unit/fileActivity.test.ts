import { describe, expect, it } from 'vitest'
import { ago, blameLines, collectEdits } from '../../src/shared/fileActivity'
import type { TimelineEvent } from '../../src/shared/timeline'

const ev = (over: Partial<TimelineEvent> & { kind: TimelineEvent['kind'] }): TimelineEvent => ({ id: '0', at: 0, text: '', ...over })

describe('collectEdits', () => {
  const events = [
    ev({ kind: 'prompt', at: 1, text: 'Add the   search panel' }),
    ev({ kind: 'edit', at: 2, path: 'C:\\proj\\src\\a.ts', added: 5, removed: 1 }),
    ev({ kind: 'prompt', at: 3, text: 'Now fix tests' }),
    ev({ kind: 'edit', at: 4, path: 'C:/proj/src/a.ts', added: 2 }),
    ev({ kind: 'read', at: 5, path: 'C:/proj/src/b.ts' })
  ]
  it('keys by repo-relative path and attaches the prompt in force', () => {
    const edits = collectEdits(events, 'C:\\proj')
    expect([...edits.keys()]).toEqual(['src/a.ts'])
    expect(edits.get('src/a.ts')).toEqual([
      { at: 2, added: 5, removed: 1, task: 'Add the search panel' },
      { at: 4, added: 2, removed: 0, task: 'Now fix tests' }
    ])
  })
  it('puts the project prefix back on paths', () => {
    expect([...collectEdits(events, 'C:/proj', 'pkg').keys()]).toEqual(['pkg/src/a.ts'])
  })
})

describe('blameLines', () => {
  const a = { key: 'a', label: 'Auth session', edits: [{ at: 10, added: 2, removed: 0, task: 'login' }] }
  const b = { key: 'b', label: 'Docs session', edits: [{ at: 20, added: 1, removed: 0, task: 'docs' }] }
  it('gives one session every added line, with its latest task', () => {
    const map = blameLines([3, 4, 9], [{ ...a, edits: [...a.edits, { at: 30, added: 0, removed: 1, task: 'later' }] }])
    expect([...map.keys()]).toEqual([3, 4, 9])
    expect(map.get(9)).toMatchObject({ label: 'Auth session', task: 'later', at: 30 })
  })
  it('hands lines out in file order to edits in time order', () => {
    const map = blameLines([7, 1, 2], [b, a])
    expect(map.get(1)?.label).toBe('Auth session')
    expect(map.get(2)?.label).toBe('Auth session')
    expect(map.get(7)?.label).toBe('Docs session')
  })
  it('carries the agent kind so the gutter can show its mark', () => {
    expect(blameLines([3], [{ ...a, agent: 'codex' }]).get(3)?.agent).toBe('codex')
    const map = blameLines([7, 1, 2], [{ ...b, agent: 'gemini' }, { ...a, agent: 'claude' }])
    expect(map.get(1)?.agent).toBe('claude')
    expect(map.get(7)?.agent).toBe('gemini')
  })
  it('leaves lines nothing accounts for unmarked', () => {
    const map = blameLines([1, 2, 3, 4], [a, b])
    expect(map.has(4)).toBe(false)
  })
  it('shows nothing without data', () => {
    expect(blameLines([1], []).size).toBe(0)
    expect(blameLines([], [a]).size).toBe(0)
    expect(blameLines([1, 2], [a, { ...b, edits: [{ at: 1, added: 0, removed: 3, task: '' }] }]).size).toBe(2)
  })
})

describe('ago', () => {
  it('uses minutes, hours and days', () => {
    const now = 10 * 86_400_000
    expect(ago(now - 10_000, now)).toBe('just now')
    expect(ago(now - 5 * 60_000, now)).toBe('5m ago')
    expect(ago(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(ago(now - 4 * 86_400_000, now)).toBe('4d ago')
  })
})
