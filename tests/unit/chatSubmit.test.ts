import { describe, expect, it } from 'vitest'
import { submitDelayFor } from '../../src/shared/chatSubmit'

describe('submitDelayFor', () => {
  it('waits past the Codex paste window so Enter sends instead of adding a newline', () => {
    expect(submitDelayFor('codex')).toBeGreaterThanOrEqual(300)
  })

  it('keeps Claude quick', () => {
    expect(submitDelayFor('claude')).toBeLessThan(100)
  })

  it('has a delay for every agent kind', () => {
    for (const agent of ['claude', 'codex', 'gemini', 'shell'] as const) expect(submitDelayFor(agent)).toBeGreaterThan(0)
  })
})
