import { describe, expect, it } from 'vitest'
import { choiceFromKey, inboxOrder, inboxSummary, inboxWants, moveSelection, selectionAfterRemoval, stateWait, type InboxEntry } from '../../src/shared/inbox'

const entry = (paneId: string, state: InboxEntry['state'], since: number, unread = false): InboxEntry => ({ paneId, state, unread, since })

describe('inbox order', () => {
  it('lists sessions that need you first, the longest wait first, then unread ones, the newest first', () => {
    const order = inboxOrder([entry('done-old', 'done', 10, true), entry('needs-new', 'needs', 90), entry('idle', 'idle', 5), entry('needs-old', 'needs', 20), entry('done-new', 'done', 50, true), entry('working', 'working', 1, false)])
    expect(order.map((item) => item.paneId)).toEqual(['needs-old', 'needs-new', 'done-new', 'done-old'])
  })

  it('wants a finished session only while it is unread, and never an exited one', () => {
    expect(inboxWants(entry('a', 'done', 0, false))).toBe(false)
    expect(inboxWants(entry('a', 'idle', 0, true))).toBe(true)
    expect(inboxWants(entry('a', 'exited', 0, true))).toBe(false)
    expect(inboxWants(entry('a', 'needs', 0, false))).toBe(true)
  })

  it('summarises the counts', () => {
    expect(inboxSummary([entry('a', 'needs', 0), entry('b', 'needs', 0), entry('c', 'done', 0, true), entry('d', 'done', 0, true)])).toBe('2 need you · 2 unread')
    expect(inboxSummary([entry('a', 'needs', 0)])).toBe('1 needs you')
    expect(inboxSummary([])).toBe('')
  })
})

describe('inbox selection', () => {
  const ids = ['a', 'b', 'c']

  it('moves inside the list and falls back to the first entry', () => {
    expect(moveSelection(ids, 'a', 1)).toBe('b')
    expect(moveSelection(ids, 'c', 1)).toBe('c')
    expect(moveSelection(ids, 'a', -1)).toBe('a')
    expect(moveSelection(ids, null, 1)).toBe('a')
    expect(moveSelection(ids, 'gone', -1)).toBe('a')
    expect(moveSelection([], 'a', 1)).toBeNull()
  })

  it('moves to the entry that takes the removed one place, else the one before it', () => {
    expect(selectionAfterRemoval(ids, ['a', 'c'], 'b')).toBe('c')
    expect(selectionAfterRemoval(ids, ['a', 'b'], 'c')).toBe('b')
    expect(selectionAfterRemoval(['a'], [], 'a')).toBeNull()
  })

  it('maps 1 to 9 to choices that exist', () => {
    expect(choiceFromKey('2', 3)).toBe(2)
    expect(choiceFromKey('4', 3)).toBeNull()
    expect(choiceFromKey('0', 9)).toBeNull()
    expect(choiceFromKey('a', 9)).toBeNull()
  })

  it('shows the state with its wait', () => {
    expect(stateWait({ state: 'needs', since: 0, now: 4 * 60_000 })).toBe('Needs you · 4m')
    expect(stateWait({ state: 'done', since: 0, now: 90 * 60_000 })).toBe('Done · 1h')
    expect(stateWait({ state: 'done', since: 0, now: 10_000 })).toBe('Done')
  })
})
