import { describe, expect, it } from 'vitest'
import { clearConfirm, contextHeading, contextNoteText, contextReading, contextWarn, stepContextNote } from '../../src/shared/chatContext'

describe('contextReading', () => {
  it('uses the reported share and keeps the counts', () => {
    expect(contextReading({ agent: 'claude', percent: 62.4, tokens: 124_000, window: 200_000 })).toEqual({ percent: 62, tokens: 124_000, window: 200_000 })
  })

  it('works the share out from counts when there is none', () => {
    expect(contextReading({ agent: 'claude', percent: null, tokens: 50_000, window: 200_000 })?.percent).toBe(25)
  })

  it('shows no meter for Gemini or an uncounted session', () => {
    expect(contextReading({ agent: 'gemini', percent: 40, tokens: null, window: null })).toBeNull()
    expect(contextReading({ agent: 'codex', percent: null, tokens: null, window: null })).toBeNull()
  })

  it('keeps the share between 0 and 100', () => {
    expect(contextReading({ agent: 'codex', percent: 140, tokens: null, window: null })?.percent).toBe(100)
  })
})

describe('context text', () => {
  it('warns from 85 percent', () => {
    expect(contextWarn({ percent: 84, tokens: null, window: null })).toBe(false)
    expect(contextWarn({ percent: 85, tokens: null, window: null })).toBe(true)
  })

  it('names the counts when known, else the share', () => {
    expect(contextHeading({ percent: 62, tokens: 124_000, window: 200_000 })).toBe('Context · 124K of 200K tokens')
    expect(contextHeading({ percent: 62, tokens: null, window: null })).toBe('Context · 62% full')
  })

  it('writes the note for the agent', () => {
    const note = contextNoteText(88, 'Claude')
    expect(note.lead).toBe('Context is 88% full.')
    expect(note.rest).toContain("Claude doesn't do it")
  })

  it('names the session in the clear confirm', () => {
    const confirm = clearConfirm('Billing refactor')
    expect(confirm.confirmLabel).toBe('Clear Billing refactor')
    expect(confirm.body).toContain('Billing refactor')
  })
})

describe('stepContextNote', () => {
  it('shows above the line until dismissed', () => {
    expect(stepContextNote({ dismissed: false }, 88).show).toBe(true)
    expect(stepContextNote({ dismissed: true }, 90).show).toBe(false)
  })

  it('stays hidden below the line and forgets a dismissal after a compact', () => {
    const after = stepContextNote({ dismissed: true }, 20)
    expect(after.show).toBe(false)
    expect(after.memory.dismissed).toBe(false)
    expect(stepContextNote(after.memory, 86).show).toBe(true)
  })

  it('does nothing without a reading', () => {
    expect(stepContextNote({ dismissed: true }, null)).toEqual({ memory: { dismissed: true }, show: false })
  })
})
