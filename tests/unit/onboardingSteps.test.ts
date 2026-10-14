import { describe, expect, it } from 'vitest'
import { STARTER_PROMPTS, onboardingProgress, pickStartAgent, starterPromptById } from '../../src/shared/onboardingSteps'

describe('onboardingProgress', () => {
  it('starts at step one with nothing done', () => {
    expect(onboardingProgress({ projects: 0, installedAgents: 2 })).toEqual({ done: 1, total: 3, percent: 33, label: '1 of 3', active: 1 })
    expect(onboardingProgress({ projects: 0, installedAgents: 0 })).toMatchObject({ done: 0, label: '0 of 3', percent: 0, active: 1 })
  })

  it('moves to the agents step once a project exists', () => {
    expect(onboardingProgress({ projects: 1, installedAgents: 0 })).toMatchObject({ done: 1, active: 2 })
  })

  it('reaches the session step when a project and an agent are ready', () => {
    expect(onboardingProgress({ projects: 3, installedAgents: 1 })).toEqual({ done: 2, total: 3, percent: 67, label: '2 of 3', active: 3 })
  })
})

describe('pickStartAgent', () => {
  it('keeps the preferred agent when installed or unknown', () => {
    expect(pickStartAgent('claude', ['claude', 'codex'])).toBe('claude')
    expect(pickStartAgent('codex', null)).toBe('codex')
    expect(pickStartAgent('gemini', [])).toBe('gemini')
  })

  it('falls back to the first installed agent', () => {
    expect(pickStartAgent('claude', ['codex', 'gemini'])).toBe('codex')
  })
})

describe('starter prompts', () => {
  it('has unique ids and can be looked up', () => {
    expect(new Set(STARTER_PROMPTS.map((p) => p.id)).size).toBe(STARTER_PROMPTS.length)
    expect(starterPromptById('readme')?.label).toBe('Write a README')
    expect(starterPromptById(null)).toBeNull()
    expect(starterPromptById('nope')).toBeNull()
  })
})
