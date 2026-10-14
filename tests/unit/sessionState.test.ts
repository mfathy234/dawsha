import { describe, expect, it } from 'vitest'
import { compareSessionStates, countSessionStates, sessionState } from '../../src/shared/sessionState'

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
