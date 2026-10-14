import { describe, expect, it } from 'vitest'
import { compareSessionStates, countSessionStates, formatTimeInState, sessionState, stepStateClock } from '../../src/shared/sessionState'

describe('sessionState', () => {
  it('puts a permission prompt above everything else', () => {
    expect(sessionState({ status: 'busy', attention: 'needs' })).toBe('needs')
    expect(sessionState({ status: 'exited', attention: 'needs' })).toBe('needs')
  })

  it('maps busy to working, an unseen finish to done, and the rest to idle or exited', () => {
    expect(sessionState({ status: 'busy', attention: 'none' })).toBe('working')
    expect(sessionState({ status: 'idle', attention: 'done' })).toBe('done')
    expect(sessionState({ status: 'idle', attention: 'none' })).toBe('idle')
    expect(sessionState({ status: 'exited', attention: 'none' })).toBe('exited')
  })

  it('counts states and sorts the most urgent first', () => {
    expect(countSessionStates(['needs', 'working', 'done', 'idle', 'working'])).toEqual({ total: 5, needs: 1, working: 2, done: 1 })
    const sorted = (['idle', 'working', 'needs', 'exited', 'done'] as const).slice().sort(compareSessionStates)
    expect(sorted).toEqual(['needs', 'done', 'working', 'idle', 'exited'])
  })
})

describe('state clock', () => {
  it('keeps the start time while the state holds and restarts it when the state changes', () => {
    const first = stepStateClock(undefined, 'working', 1_000)
    expect(first).toEqual({ state: 'working', since: 1_000 })
    expect(stepStateClock(first, 'working', 90_000)).toBe(first)
    expect(stepStateClock(first, 'needs', 90_000)).toEqual({ state: 'needs', since: 90_000 })
  })

  it('shows whole minutes only, so the label does not change every second', () => {
    expect(formatTimeInState(0)).toBe('')
    expect(formatTimeInState(59_999)).toBe('')
    expect(formatTimeInState(60_000)).toBe('1m')
    expect(formatTimeInState(61_000)).toBe('1m')
    expect(formatTimeInState(59 * 60_000)).toBe('59m')
    expect(formatTimeInState(2 * 3_600_000 + 5 * 60_000)).toBe('2h')
    expect(formatTimeInState(50 * 3_600_000)).toBe('2d')
  })
})
