import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../../src/shared/chatLog'
import { clockTime, limitSituation, limitTitle, notifyAtLabel, resetLine, sendAtLabel, sendsAtNote, withStoppedMessage } from '../../src/shared/chatLimit'
import { holdUntil, newPending, releaseHeld } from '../../src/shared/chatPending'

const user = (text: string): ChatItem => ({ kind: 'message', id: 'u', role: 'user', text })
const agent = (text: string): ChatItem => ({ kind: 'message', id: 'a', role: 'agent', text })
const limit = (resetsAt?: number): ChatItem => ({ kind: 'notice', id: 'n', notice: 'limit', text: 'Limit', ...(resetsAt ? { resetsAt } : {}) })

describe('limitSituation', () => {
  it('finds the stopped message and the reset time', () => {
    expect(limitSituation([agent('hi'), user('update the pdf'), limit(5000)])).toEqual({ resetsAt: 5000, pendingText: 'update the pdf' })
  })

  it('has no stopped message when the agent spoke last', () => {
    expect(limitSituation([user('go'), agent('done'), limit()])).toEqual({ resetsAt: null, pendingText: null })
  })

  it('is null when the thread does not end with a limit', () => {
    expect(limitSituation([user('go'), limit(), agent('back')])).toBeNull()
  })
})

describe('limit text', () => {
  const at = new Date(2026, 0, 1, 15, 40).getTime()
  const now = at - (2 * 60 + 10) * 60_000

  it('formats the clock', () => {
    expect(clockTime(at)).toBe('15:40')
    expect(sendAtLabel(at)).toBe('Send at 15:40')
    expect(notifyAtLabel(at)).toBe('Notify me at 15:40')
    expect(sendsAtNote(at)).toBe('Sends at 15:40')
  })

  it('says when it resets and whether a message was held back', () => {
    expect(resetLine(at, now, true)).toBe('It resets at 15:40, in 2h 10m. Your message above was not sent.')
    expect(resetLine(at, now, false)).toBe('It resets at 15:40, in 2h 10m.')
  })

  it('copes with an unknown or past reset', () => {
    expect(resetLine(null, now, false)).toContain('not reported')
    expect(resetLine(now - 1, now, false)).toContain('reset by now')
  })

  it('names the agent and adds the stopped message to a handoff', () => {
    expect(limitTitle('Claude')).toBe("Claude's usage limit is reached.")
    expect(withStoppedMessage('summary', 'do it')).toContain('do it')
    expect(withStoppedMessage('summary', null)).toBe('summary')
  })
})

describe('a message held until the reset', () => {
  const message = newPending('p1', 'update the pdf', 0, [], false, false)

  it('is not released before its time, then is', () => {
    const held = holdUntil([], message, 1000)
    expect(releaseHeld(held, false, false, false, 999).message).toBeNull()
    expect(releaseHeld(held, false, false, false, 1000).message?.text).toBe('update the pdf')
  })
})
