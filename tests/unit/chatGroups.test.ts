import { describe, expect, it } from 'vitest'
import type { ChatItem, ChatMessage, ChatTool } from '../../src/shared/chatLog'
import type { ToolKind } from '../../src/shared/chatKind'
import { GROUP_MIN, groupKey, groupLabel, groupMembership, groupTools } from '../../src/shared/chatGroups'

const tool = (id: string, activity: ToolKind, extra: Partial<ChatTool> = {}): ChatTool => ({ kind: 'tool', id, activity, verb: 'Read', target: id, output: '', outputTruncated: false, done: true, ...extra })
const say = (id: string): ChatMessage => ({ kind: 'message', id, role: 'agent', text: id })
const groups = (items: ChatItem[], breaks?: Set<number>) => groupTools(items, breaks).filter((entry) => entry.type === 'group')

describe('groupTools', () => {
  it('folds three or more consecutive reads and searches into one group', () => {
    const entries = groupTools([tool('a', 'read'), tool('b', 'search'), tool('c', 'read')])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ type: 'group', group: { id: 'a', reads: 2, searches: 1 } })
    expect(GROUP_MIN).toBe(3)
  })

  it('leaves runs shorter than three as plain rows', () => {
    const entries = groupTools([tool('a', 'read'), tool('b', 'read')])
    expect(entries.map((entry) => entry.type)).toEqual(['item', 'item'])
  })

  it('never folds edits, failures, shell commands, questions, todos or running tools', () => {
    const items = [
      tool('r1', 'read'), tool('r2', 'read'), tool('r3', 'read'),
      tool('e', 'edit'),
      tool('f1', 'read', { failed: true }), tool('f2', 'read'), tool('f3', 'read'),
      tool('s', 'shell'), tool('q', 'question'), tool('t', 'todo')
    ]
    const found = groups(items)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ group: { id: 'r1' } })
    expect(groups([tool('x1', 'read'), tool('x2', 'read'), tool('x3', 'read', { done: false })])).toHaveLength(0)
  })

  it('keeps a read that shows a picture visible', () => {
    const items = [tool('a', 'read'), tool('b', 'read', { images: [{ id: 'i' } as never] }), tool('c', 'read'), tool('d', 'read')]
    expect(groups(items)).toHaveLength(0)
  })

  it('is cut by messages, and by the indexes it is told to break at', () => {
    const items = [tool('a', 'read'), tool('b', 'read'), say('m'), tool('c', 'read'), tool('d', 'read'), tool('e', 'read'), tool('f', 'read')]
    const found = groups(items)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ group: { id: 'c' } })
    expect(groups(items, new Set([5]))).toHaveLength(0)
  })

  it('keeps the id of the first tool as the run grows', () => {
    const three = groups([tool('a', 'read'), tool('b', 'read'), tool('c', 'read')])
    const four = groups([tool('a', 'read'), tool('b', 'read'), tool('c', 'read'), tool('d', 'read')])
    expect(three[0]).toMatchObject({ group: { id: 'a' } })
    expect(four[0]).toMatchObject({ group: { id: 'a' } })
  })

  it('times the run from its first tool to the next item', () => {
    const items: ChatItem[] = [tool('a', 'read', { at: 1000 }), tool('b', 'read', { at: 5000 }), tool('c', 'read', { at: 9000 }), { ...say('m'), at: 23_000 }]
    expect(groupTools(items)[0]).toMatchObject({ type: 'group', group: { ms: 22_000 } })
  })

  it('has no time when the log has none', () => {
    const [entry] = groupTools([tool('a', 'read'), tool('b', 'read'), tool('c', 'read')])
    expect(entry).toMatchObject({ type: 'group', group: { ms: undefined } })
  })
})

describe('groupLabel', () => {
  const make = (reads: number, searches: number, ms?: number) => ({ reads, searches, ms })
  it('counts files read and searches made', () => {
    expect(groupLabel(make(14, 6, 22_000))).toBe('Read 14 files, searched 6 times · 22s')
    expect(groupLabel(make(3, 0, undefined))).toBe('Read 3 files')
    expect(groupLabel(make(0, 4, 90_000))).toBe('Searched 4 times · 1m 30s')
    expect(groupLabel(make(1, 1, undefined))).toBe('Read 1 file, searched 1 time')
  })
})

describe('groupMembership', () => {
  it('maps each folded tool to its group key', () => {
    const map = groupMembership(groupTools([tool('a', 'read'), tool('b', 'read'), tool('c', 'read'), tool('z', 'edit')]))
    expect(map.get('b')).toBe(groupKey('a'))
    expect(map.has('z')).toBe(false)
  })
})
