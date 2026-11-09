import { describe, expect, it } from 'vitest'
import { pauseConfirm, pauseTargets } from '../../src/shared/pauseAgents'

const views = [
  { tabId: 'a', projectId: 'p1', agent: 'claude', status: 'busy' },
  { tabId: 'b', projectId: 'p1', agent: 'shell', status: 'busy' },
  { tabId: 'c', projectId: 'p2', agent: 'codex', status: 'busy' },
  { tabId: 'd', projectId: 'p1', agent: 'gemini', status: 'idle' },
  { tabId: 'e', projectId: 'p1', agent: 'gemini', status: 'busy' }
] as const

describe('pauseTargets', () => {
  it('takes only working agent sessions, never shells or idle ones', () => {
    expect(pauseTargets(views)).toEqual(['a', 'c', 'e'])
  })
  it('can be limited to one project', () => {
    expect(pauseTargets(views, 'p1')).toEqual(['a', 'e'])
  })
})

describe('pauseConfirm', () => {
  it('names the count in the message and on the button', () => {
    expect(pauseConfirm(3)).toMatchObject({ title: 'Interrupt 3 working sessions?', confirmLabel: 'Interrupt 3 sessions' })
    expect(pauseConfirm(1)).toMatchObject({ title: 'Interrupt 1 working session?', confirmLabel: 'Interrupt 1 session' })
  })
  it('names the project when there is one', () => {
    expect(pauseConfirm(2, 'dawsha').body).toContain('dawsha')
  })
})
