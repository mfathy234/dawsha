import { describe, expect, it } from 'vitest'
import { formatSpecComments } from '../../src/shared/orch/specReview'

describe('spec feedback', () => {
  it('formats targets and multiline comments as one Markdown list per comment', () => {
    expect(formatSpecComments([{ target: 'spec', text: '  Add empty state\nExplain retry  ' }, { target: 'export.html', text: 'Make Cancel visible' }], 'Clarify costs')).toBe('- [spec] Add empty state\n  Explain retry\n- [mockup export.html] Make Cancel visible\n- [spec] Clarify costs')
  })
  it('requires comments or a note and ignores whitespace', () => {
    expect(formatSpecComments([{ target: 'spec', text: ' ' }], ' ')).toBeNull()
    expect(formatSpecComments([], ' Fix it ')).toBe('- [spec] Fix it')
  })
})
