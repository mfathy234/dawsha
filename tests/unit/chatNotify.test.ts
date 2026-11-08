import { describe, expect, it } from 'vitest'
import type { ChatItem, ChatMessage } from '../../src/shared/chatLog'
import { doneMessage, settleWatches, watchableMessageId } from '../../src/shared/chatNotify'

const say = (id: string, role: 'user' | 'agent', text = id): ChatMessage => ({ kind: 'message', id, role, text })

describe('watchableMessageId', () => {
  const items: ChatItem[] = [say('u1', 'user'), say('a1', 'agent'), say('u2', 'user')]
  it('is the latest user message while its turn is still running', () => {
    expect(watchableMessageId(items, 'working')).toBe('u2')
    expect(watchableMessageId(items, 'approval')).toBe('u2')
    expect(watchableMessageId(items, 'menu')).toBe('u2')
  })
  it('is nothing once the turn is over, or when there is no user message', () => {
    expect(watchableMessageId(items, 'done')).toBeNull()
    expect(watchableMessageId(items, 'limit')).toBeNull()
    expect(watchableMessageId([say('a1', 'agent')], 'working')).toBeNull()
  })
})

describe('settleWatches', () => {
  it('keeps every watch while the turn runs', () => {
    expect(settleWatches(['u2'], 'working')).toEqual({ keep: ['u2'], finished: [] })
    expect(settleWatches(['u2'], 'approval')).toEqual({ keep: ['u2'], finished: [] })
  })
  it('finishes them when the session is idle again', () => {
    expect(settleWatches(['u2'], 'done')).toEqual({ keep: [], finished: ['u2'] })
    expect(settleWatches(['u2'], 'limit')).toEqual({ keep: [], finished: ['u2'] })
  })
})

describe('doneMessage', () => {
  it('names the agent and quotes the start of the message', () => {
    expect(doneMessage('Claude', 'Smoke', 'Add a retry to the sender')).toEqual({ title: 'Claude is done', body: 'Smoke: "Add a retry to the sender"' })
  })
  it('cuts a long message and copes with no project', () => {
    const body = doneMessage('Codex', '', 'x'.repeat(200)).body
    expect(body.length).toBeLessThan(90)
    expect(body.endsWith('…"')).toBe(true)
  })
})
