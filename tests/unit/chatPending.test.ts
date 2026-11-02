import { describe, expect, it } from 'vitest'
import { agentReady, isStarting, STARTUP_MAX_MS } from '../../src/shared/agentReady'
import type { ChatItem } from '../../src/shared/chatLog'
import { isTracked, newPending, pendingLabel, settlePending, userIds } from '../../src/shared/chatPending'

const user = (id: string, text: string): ChatItem => ({ kind: 'message', id, role: 'user', text })
const agent = (id: string, text: string): ChatItem => ({ kind: 'message', id, role: 'agent', text })

describe('settlePending', () => {
  it('keeps a message until the log shows it as a new user turn', () => {
    const before = [user('u1', 'hello'), agent('a1', 'hi')]
    const pending = [newPending('p', 'again', 0, before, false, false)]
    expect(settlePending(pending, before, 1000, true)).toHaveLength(1)
    expect(settlePending(pending, [...before, user('u2', 'again')], 1000, true)).toHaveLength(0)
  })

  it('does not settle on an older identical message', () => {
    const before = [user('u1', 'same')]
    const pending = [newPending('p', 'same', 0, before, false, true)]
    expect(settlePending(pending, before, 1000, true)).toHaveLength(1)
  })

  it('matches ignoring whitespace and settles one message per log turn', () => {
    const pending = [newPending('p1', 'a  b', 0, [], false, true), newPending('p2', 'a b', 1, [], false, true)]
    expect(settlePending(pending, [user('u1', 'a b')], 10, true).map((m) => m.id)).toEqual(['p2'])
  })

  it('keeps a waiting message and drops an idle one that never arrives', () => {
    const waiting = newPending('w', 'x', 0, [], true, false)
    const sent = newPending('s', 'y', 0, [], false, false)
    expect(settlePending([waiting, sent], [], 60_000, false).map((m) => m.id)).toEqual(['w'])
    expect(settlePending([sent], [], 60_000, true)).toHaveLength(1)
  })

  it('labels by what is happening', () => {
    expect(pendingLabel(newPending('a', 'x', 0, [], true, true))).toBe('waiting')
    expect(pendingLabel(newPending('a', 'x', 0, [], false, true))).toBe('queued')
    expect(pendingLabel(newPending('a', 'x', 0, [], false, false))).toBe('sending')
  })

  it('does not track slash commands or shell lines', () => {
    expect(isTracked('/clear')).toBe(false)
    expect(isTracked('!ls')).toBe(false)
    expect(isTracked('fix it')).toBe(true)
    expect(userIds([user('u', 'x'), agent('a', 'y')])).toEqual(['u'])
  })
})

describe('agentReady', () => {
  it('sees the input box and footer', () => {
    expect(agentReady('╭────╮\n│ > │\n╰────╯\n  ? for shortcuts')).toBe(true)
    expect(agentReady('› Ask Codex\n  100% context left')).toBe(true)
  })

  it('does not take a menu or a banner for it', () => {
    expect(agentReady('Do you trust this folder?\n❯ 1. Yes\n  2. No')).toBe(false)
    expect(agentReady('Claude Code v2.0\nLoading…')).toBe(false)
    expect(agentReady('')).toBe(false)
  })
})

describe('isStarting', () => {
  const base = { agent: 'claude' as const, status: 'running' as const, startedAt: 0, now: 1000, tail: '', working: false }

  it('is true until the prompt shows', () => {
    expect(isStarting(base)).toBe(true)
    expect(isStarting({ ...base, tail: '> \n? for shortcuts' })).toBe(false)
    expect(isStarting({ ...base, status: 'starting', tail: '> ' })).toBe(true)
  })

  it('gives up after a while and ignores working or exited sessions', () => {
    expect(isStarting({ ...base, now: STARTUP_MAX_MS + 1 })).toBe(false)
    expect(isStarting({ ...base, working: true })).toBe(false)
    expect(isStarting({ ...base, status: 'exited' })).toBe(false)
  })
})
