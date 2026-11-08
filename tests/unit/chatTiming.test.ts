import { describe, expect, it } from 'vitest'
import type { ChatItem, ChatMessage, ChatTool } from '../../src/shared/chatLog'
import { formatDuration, turnTimings, workedLabel } from '../../src/shared/chatTiming'

const say = (id: string, role: 'user' | 'agent', at?: number): ChatMessage => ({ kind: 'message', id, role, text: id, ...(at !== undefined ? { at } : {}) })
const tool = (id: string, at?: number): ChatTool => ({ kind: 'tool', id, activity: 'read', verb: 'Read', target: id, output: '', outputTruncated: false, done: true, ...(at !== undefined ? { at } : {}) })

describe('formatDuration', () => {
  it('writes seconds, minutes and hours the short way', () => {
    expect(formatDuration(22_000)).toBe('22s')
    expect(formatDuration(134_000)).toBe('2m 14s')
    expect(formatDuration(120_000)).toBe('2m')
    expect(formatDuration(3_900_000)).toBe('1h 5m')
    expect(formatDuration(3_600_000)).toBe('1h')
  })
  it('rounds sub-second times up to one second', () => {
    expect(formatDuration(400)).toBe('1s')
  })
})

describe('turnTimings', () => {
  it('measures from the user message to the last item of the turn and counts tools', () => {
    const items: ChatItem[] = [say('u1', 'user', 1_000), tool('t1', 5_000), tool('t2', 9_000), say('a1', 'agent', 135_000)]
    expect(turnTimings(items)).toEqual([{ replyId: 'a1', ms: 134_000, tools: 2 }])
  })

  it('attaches to the last agent reply of the turn', () => {
    const items: ChatItem[] = [say('u1', 'user', 0), say('a1', 'agent', 5_000), tool('t1', 6_000), say('a2', 'agent', 20_000)]
    expect(turnTimings(items).map((t) => t.replyId)).toEqual(['a2'])
  })

  it('handles several turns separately', () => {
    const items: ChatItem[] = [say('u1', 'user', 0), say('a1', 'agent', 10_000), say('u2', 'user', 20_000), tool('t1', 25_000), say('a2', 'agent', 50_000)]
    expect(turnTimings(items)).toEqual([
      { replyId: 'a1', ms: 10_000, tools: 0 },
      { replyId: 'a2', ms: 30_000, tools: 1 }
    ])
  })

  it('leaves a turn out when a time is unknown, there is no reply, or it took under a second', () => {
    expect(turnTimings([say('u1', 'user'), say('a1', 'agent', 5_000)])).toEqual([])
    expect(turnTimings([say('u1', 'user', 0), tool('t1', 1_000)])).toEqual([])
    expect(turnTimings([say('u1', 'user', 0), say('a1', 'agent', 400)])).toEqual([])
    expect(turnTimings([say('a0', 'agent', 5_000)])).toEqual([])
  })

  it('uses the latest known time when the last item has none', () => {
    const items: ChatItem[] = [say('u1', 'user', 0), tool('t1', 8_000), say('a1', 'agent')]
    expect(turnTimings(items)).toEqual([{ replyId: 'a1', ms: 8_000, tools: 1 }])
  })
})

describe('workedLabel', () => {
  it('says how long and how many tools', () => {
    expect(workedLabel({ replyId: 'a', ms: 134_000, tools: 9 })).toBe('Worked 2m 14s · 9 tools')
    expect(workedLabel({ replyId: 'a', ms: 5_000, tools: 1 })).toBe('Worked 5s · 1 tool')
    expect(workedLabel({ replyId: 'a', ms: 5_000, tools: 0 })).toBe('Worked 5s')
  })
})
