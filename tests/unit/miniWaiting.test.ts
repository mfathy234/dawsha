import { describe, expect, it } from 'vitest'
import { miniWaiting } from '../../src/shared/miniWaiting'
import { miniSession, type MiniSessionInput } from '../../src/shared/miniWindow'

const PICKER = ['Which database should we use?', '', '❯ 1. Postgres', '  2. SQLite', '  3. Type something', '', 'Enter to select · Esc to cancel'].join('\n')

describe('Mini waiting reason', () => {
  it('has none for a tool permission prompt, which has its own box', () => {
    expect(miniWaiting('● Bash(npm test)\nDo you want to proceed?\n1. Yes\n3. No', [])).toBeNull()
  })

  it('reads a numbered picker: its question and choices', () => {
    const waiting = miniWaiting(PICKER, [])
    expect(waiting?.kind).toBe('menu')
    expect(waiting?.question).toBe('Which database should we use?')
    expect(waiting?.choices).toEqual(['1. Postgres', '2. SQLite', '3. Something else'])
  })

  it('shows the numbered rows of a menu it cannot read as a question', () => {
    const waiting = miniWaiting(['Select model', '❯ 1. Opus', '  2. Sonnet', 'Enter to confirm · Esc to exit'].join('\n'), [])
    expect(waiting?.kind).toBe('menu')
    expect(waiting?.choices).toEqual(['1. Opus', '2. Sonnet'])
  })

  it('falls back to the question in the last reply, which does not block replying', () => {
    const waiting = miniWaiting('> ', ['I changed the file.', 'Should I run the tests too?'])
    expect(waiting).toEqual({ kind: 'question', question: 'Should I run the tests too?', choices: [] })
  })

  it('has an empty question when it knows nothing, so the card says Needs you and the detail says to open the session', () => {
    expect(miniWaiting('', [])).toEqual({ kind: 'question', question: '', choices: [] })
  })

  it('reaches the snapshot only for a needs-you session without a permission prompt', () => {
    const base: MiniSessionInput = { paneId: 'a', agent: 'claude', title: 'T', project: 'P', status: 'idle', attention: 'needs', tail: PICKER, recap: '', tool: '', idleFor: '', changed: null, todos: [] }
    const session = miniSession(base)
    expect(session.permission).toBeNull()
    expect(session.waiting?.choices).toHaveLength(3)
    expect(session.line).toBe('Which database should we use?')
    expect(session.now).toBe('Waiting for you: Which database should we use?')
    expect(miniSession({ ...base, attention: 'none', tail: '' }).waiting).toBeNull()
    expect(miniSession({ ...base, tail: '' }).line).toBe('Needs you')
  })
})
