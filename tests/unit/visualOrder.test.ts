import bidiFactory from 'bidi-js'
import { describe, expect, it } from 'vitest'
import { logicalFromVisual, logicalText, visualFromLogical } from '../../src/shared/visualOrder'

const bidi = bidiFactory()
const segmenter = new Intl.Segmenter('ar', { granularity: 'grapheme' })

/** How a BiDi-aware display lays out a right-to-left line, keeping harakat with their letters, as Claude Code does. */
function displayed(logical: string): string {
  const levels = bidi.getEmbeddingLevels(logical, 'rtl')
  let text = logical
  for (const [start, end] of bidi.getReorderSegments(logical, levels)) {
    const part = [...segmenter.segment(text.slice(start, end + 1))].map((s) => s.segment).reverse().join('')
    text = text.slice(0, start) + part + text.slice(end + 1)
  }
  return text
}

// Rows exactly as Claude Code 2.1 wrote them for the reply 'مَرْحَبًا بالعالم 42 develop يا صديقي' and the prompt
// 'مساء الخير abc'.
describe('logicalFromVisual', () => {
  it('turns a Claude reply back into reading order, keeping numbers, Latin words and harakat intact', () => {
    const reply = 'يقيدص اي develop 42 ملاعلاب ابًحَرْمَ'
    const copied = logicalFromVisual(reply)
    // The Arabic reads in order with its harakat. '42 develop' and 'develop 42' look the same inside a right-to-left
    // sentence, so either is a faithful copy: what matters is that it displays exactly as Claude showed it.
    expect(copied.startsWith('مَرْحَبًا بالعالم ')).toBe(true)
    expect(copied.endsWith(' يا صديقي')).toBe(true)
    expect(displayed(copied)).toBe(reply)
    expect(logicalFromVisual(' abc ريخلا ءاسم').trim()).toBe('مساء الخير abc')
  })

  it('keeps Claude\'s own bullets, prompt marks and indentation in place', () => {
    expect(logicalFromVisual('● ريخلا ءاسم')).toBe('● مساء الخير')
    expect(logicalFromVisual('❯ ريخلا ءاسم')).toBe('❯ مساء الخير')
    expect(logicalFromVisual('  ⎿  ريخلا ءاسم')).toBe('  ⎿  مساء الخير')
  })

  it('puts sentence punctuation back at the end', () => {
    expect(logicalFromVisual('.اركش ،ابحرم')).toBe('مرحبا، شكرا.')
  })

  it('leaves lines without Arabic alone', () => {
    expect(logicalFromVisual('● All 41 tests pass.')).toBe('● All 41 tests pass.')
    expect(logicalText('a\nb')).toBe('a\nb')
  })

  it('handles a block of lines', () => {
    expect(logicalText('● ريخلا ءاسم\nDone.')).toBe('● مساء الخير\nDone.')
  })
})

describe('visualFromLogical', () => {
  it('turns a typed search into the visual order Claude prints, so it matches the row', () => {
    expect(visualFromLogical('مساء الخير')).toBe('ريخلا ءاسم')
    expect('يقيدص اي develop 42 ملاعلاب ابًحَرْمَ').toContain(visualFromLogical('بالعالم'))
    expect(visualFromLogical('needle')).toBe('needle')
  })
})
