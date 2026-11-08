import { describe, expect, it } from 'vitest'
import type { ChatItem, ChatMessage, ChatNotice, ChatTool } from '../../src/shared/chatLog'
import { FOLD_LINES } from '../../src/shared/chatLog'
import { keysToOpen, matchOffsets, wrapIndex } from '../../src/shared/chatFind'

const tool = (id: string, extra: Partial<ChatTool> = {}): ChatTool => ({ kind: 'tool', id, activity: 'read', verb: 'Read', target: id, output: '', outputTruncated: false, done: true, ...extra })
const say = (id: string, text: string): ChatMessage => ({ kind: 'message', id, role: 'agent', text })
const none = new Map<string, string>()

describe('matchOffsets', () => {
  it('finds every occurrence ignoring case', () => {
    expect(matchOffsets('Retry the retry policy', 'RETRY')).toEqual([0, 10])
  })
  it('does not overlap and ignores an empty query', () => {
    expect(matchOffsets('aaaa', 'aa')).toEqual([0, 2])
    expect(matchOffsets('abc', '')).toEqual([])
  })
})

describe('wrapIndex', () => {
  it('steps around both ends', () => {
    expect(wrapIndex(0, -1, 3)).toBe(2)
    expect(wrapIndex(2, 1, 3)).toBe(0)
    expect(wrapIndex(0, 1, 0)).toBe(-1)
  })
})

describe('keysToOpen', () => {
  it('opens a tool row whose output holds the match', () => {
    const items: ChatItem[] = [tool('t1', { output: 'found the needle here' }), tool('t2', { output: 'nothing' })]
    expect(keysToOpen(items, 'needle', none)).toEqual(['t:t1'])
  })

  it('opens the group of a folded tool whose name matches, without opening the row', () => {
    const items: ChatItem[] = [tool('t1', { target: 'src/needle.ts' })]
    expect(keysToOpen(items, 'needle', new Map([['t1', 'g:t1']]))).toEqual(['g:t1'])
  })

  it('opens both for output inside a folded tool', () => {
    const items: ChatItem[] = [tool('t1', { output: 'needle' })]
    expect(keysToOpen(items, 'needle', new Map([['t1', 'g:t1']]))).toEqual(['g:t1', 't:t1'])
  })

  it('searches a shell command and an edit diff too', () => {
    const items: ChatItem[] = [tool('t1', { activity: 'shell', command: 'npm run needle' }), tool('t2', { activity: 'edit', diff: { lines: [{ k: 'add', t: 'const needle = 1' }], more: 0 } })]
    expect(keysToOpen(items, 'needle', none)).toEqual(['t:t1', 't:t2'])
  })

  it('opens a long message only when the match is in the folded part', () => {
    const body = Array.from({ length: FOLD_LINES + 5 }, (_, i) => `line ${i}`)
    const head = say('m1', [...body.slice(0, FOLD_LINES - 1), 'needle early', ...body.slice(FOLD_LINES)].join('\n'))
    const tail = say('m2', [...body, 'needle late'].join('\n'))
    expect(keysToOpen([head, tail], 'needle', none)).toEqual(['m:m2'])
  })

  it('opens the summary a compaction left', () => {
    const notice: ChatNotice = { kind: 'notice', id: 'n1', notice: 'compact', text: 'Conversation compacted', detail: 'we discussed the needle' }
    expect(keysToOpen([notice], 'needle', none)).toEqual(['n:n1'])
  })

  it('opens nothing for an empty query', () => {
    expect(keysToOpen([tool('t1', { output: 'x' })], '  ', none)).toEqual([])
  })
})
