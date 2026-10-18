import { describe, expect, it } from 'vitest'
import { insertionData } from '../../src/shared/insertText'

describe('insertionData', () => {
  it('sends single-line text as typed', () => {
    expect(insertionData('Review the diff', true)).toEqual({ data: 'Review the diff', flattened: false })
    expect(insertionData('Review the diff', false)).toEqual({ data: 'Review the diff', flattened: false })
  })

  it('wraps multi-line text in a bracketed paste with carriage returns so no line runs on its own', () => {
    expect(insertionData('first\r\nsecond\nthird', true)).toEqual({
      data: '\u001b[200~first\rsecond\rthird\u001b[201~',
      flattened: false
    })
  })

  it('joins multi-line text onto one line when the terminal has no bracketed paste', () => {
    expect(insertionData('first\n\n  second  \nthird', false)).toEqual({ data: 'first second third', flattened: true })
  })

  it('removes control characters that could end the paste early or run something', () => {
    const hostile = 'ok\u001b[201~rm -rf\u0007\u0003 done'
    expect(insertionData(hostile, true).data).toBe('ok[201~rm -rf done')
    expect(insertionData('a\tb', false).data).toBe('a\tb')
  })
})
