import { describe, expect, it } from 'vitest'
import { isMiniAction } from '../../src/shared/miniWindow'
import { MINI_START_MAX, miniStartRefusal, orderMiniProjects, startAgents } from '../../src/shared/miniStart'

const projects = [
  { id: 'a', name: 'Alpha', defaultAgent: 'claude' as const },
  { id: 'b', name: 'Beta', defaultAgent: 'codex' as const },
  { id: 'c', name: 'Gamma', defaultAgent: 'gemini' as const }
]

describe('orderMiniProjects', () => {
  it('puts recent projects first in the order they were used, then the rest', () => {
    expect(orderMiniProjects(projects, ['c', 'a']).map(p => p.id)).toEqual(['c', 'a', 'b'])
  })

  it('ignores recent ids that no longer exist and carries the default agent', () => {
    expect(orderMiniProjects(projects, ['gone', 'b'])).toEqual([
      { id: 'b', name: 'Beta', agent: 'codex' }, { id: 'a', name: 'Alpha', agent: 'claude' }, { id: 'c', name: 'Gamma', agent: 'gemini' }
    ])
  })
})

describe('startAgents', () => {
  it('offers all three before the install check ran', () => {
    expect(startAgents(null)).toEqual(['claude', 'codex', 'gemini'])
  })

  it('offers only the agents the check found', () => {
    expect(startAgents([{ agent: 'claude', present: true }, { agent: 'codex', present: false }])).toEqual(['claude'])
  })
})

describe('miniStartRefusal', () => {
  const options = { projects: orderMiniProjects(projects, []), agents: ['claude' as const, 'codex' as const] }

  it('accepts a known project and an installed agent, with or without a first message', () => {
    expect(miniStartRefusal({ projectId: 'a', agent: 'claude', text: '' }, options)).toBeNull()
    expect(miniStartRefusal({ projectId: 'b', agent: 'codex', text: 'fix the build' }, options)).toBeNull()
  })

  it('refuses a missing project, an agent that is not installed and a message that is too long', () => {
    expect(miniStartRefusal({ projectId: 'zzz', agent: 'claude', text: '' }, options)).toBe('That project is gone.')
    expect(miniStartRefusal({ projectId: 'a', agent: 'gemini', text: '' }, options)).toBe('That agent is not installed.')
    expect(miniStartRefusal({ projectId: 'a', agent: 'claude', text: 'x'.repeat(MINI_START_MAX + 1) }, options)).toBe('That first message is too long.')
  })
})

describe('isMiniAction for start', () => {
  it('accepts a well formed start and rejects anything else', () => {
    expect(isMiniAction({ kind: 'start', projectId: 'a', agent: 'claude', text: '' })).toBe(true)
    expect(isMiniAction({ kind: 'start', projectId: 'a', agent: 'shell', text: '' })).toBe(false)
    expect(isMiniAction({ kind: 'start', projectId: '', agent: 'claude', text: '' })).toBe(false)
    expect(isMiniAction({ kind: 'start', projectId: 'a', agent: 'claude' })).toBe(false)
    expect(isMiniAction({ kind: 'start', projectId: 'a', agent: 'claude', text: 'x', extra: 1 })).toBe(false)
    expect(isMiniAction({ kind: 'start', projectId: 'a', agent: 'claude', text: 'x'.repeat(MINI_START_MAX + 1) })).toBe(false)
  })
})
