import { describe, expect, it } from 'vitest'
import {
  buildRuns,
  hasArabic,
  inSelection,
  paletteColor,
  paragraphDirection,
  PLAIN_STYLE,
  rgbColor,
  rowSignature,
  runsText,
  textOrderFor,
  visualSegments,
  type RowCell,
  type Segment
} from '../../src/shared/arabicRows'

const cells = (text: string, style = PLAIN_STYLE): RowCell[] => [...text].map((chars) => ({ chars, width: 1, style }))

describe('hasArabic', () => {
  it('detects Arabic letters, harakat and presentation forms', () => {
    expect(hasArabic('مرحبا')).toBe(true)
    expect(hasArabic('كَتَبَ')).toBe(true)
    expect(hasArabic('ﻣﺮﺣﺒﺎ')).toBe(true)
    expect(hasArabic('ݐ')).toBe(true)
  })

  it('ignores English, digits and symbols', () => {
    expect(hasArabic('hello world 123 → ✓')).toBe(false)
    expect(hasArabic('')).toBe(false)
  })
})

describe('paragraphDirection', () => {
  it('follows the first strong character', () => {
    expect(paragraphDirection('مرحبا hello')).toBe('rtl')
    expect(paragraphDirection('hello مرحبا')).toBe('ltr')
  })

  it('skips neutrals, digits and Arabic-Indic digits', () => {
    expect(paragraphDirection('> 12 ٣٤ مرحبا')).toBe('rtl')
    expect(paragraphDirection('  - 12 abc')).toBe('ltr')
  })

  it('defaults to ltr without a strong character', () => {
    expect(paragraphDirection('123 - ٣٤')).toBe('ltr')
  })
})

describe('buildRuns', () => {
  it('keeps logical order and drops trailing blanks', () => {
    const runs = buildRuns([...cells('مرحبا 5'), ...cells('   ')], null)
    expect(runsText(runs)).toBe('مرحبا 5')
  })

  it('merges adjacent cells of one style and splits on a style change', () => {
    const red = { ...PLAIN_STYLE, fg: '#ff0000' }
    const runs = buildRuns([...cells('ab', red), ...cells('جد'), ...cells('ه', red)], null)
    expect(runs.map((r) => r.text)).toEqual(['ab', 'جد', 'ه'])
    expect(runs[0].style.fg).toBe('#ff0000')
  })

  it('keeps a combining mark with its base character', () => {
    const row: RowCell[] = [{ chars: 'كَ', width: 1, style: PLAIN_STYLE }, ...cells('تب')]
    expect(runsText(buildRuns(row, null))).toBe('كَتب')
  })

  it('skips the width-0 cell after a wide character', () => {
    const row: RowCell[] = [
      { chars: '漢', width: 2, style: PLAIN_STYLE },
      { chars: '', width: 0, style: PLAIN_STYLE },
      ...cells('م')
    ]
    expect(runsText(buildRuns(row, null))).toBe('漢م')
  })

  it('marks the cursor cell and pads up to a cursor past the text', () => {
    const inside = buildRuns(cells('مرحبا'), 2)
    expect(inside.filter((r) => r.style.cursor).map((r) => r.text)).toEqual(['ح'])
    const past = buildRuns(cells('مر'), 4)
    expect(runsText(past)).toBe('مر   ')
    expect(past[past.length - 1].style.cursor).toBe(true)
  })

  it('treats a styled blank as content', () => {
    const bg = { ...PLAIN_STYLE, bg: '#112233' }
    expect(runsText(buildRuns([...cells('م'), ...cells('  ', bg)], null))).toBe('م  ')
  })
})

describe('colors', () => {
  it('maps the 16 theme colors, the 6x6x6 cube and the gray ramp', () => {
    const ansi = Array.from({ length: 16 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`)
    expect(paletteColor(3, ansi)).toBe('#000003')
    expect(paletteColor(16, ansi)).toBe('#000000')
    expect(paletteColor(196, ansi)).toBe('#ff0000')
    expect(paletteColor(231, ansi)).toBe('#ffffff')
    expect(paletteColor(232, ansi)).toBe('#080808')
    expect(rgbColor(0x12ab3c)).toBe('#12ab3c')
  })
})

describe('inSelection', () => {
  const start = { x: 3, y: 1 }
  const end = { x: 2, y: 3 }
  it('covers a multi-row range from start to end exclusive', () => {
    expect(inSelection(1, 2, start, end)).toBe(false)
    expect(inSelection(1, 3, start, end)).toBe(true)
    expect(inSelection(2, 0, start, end)).toBe(true)
    expect(inSelection(3, 1, start, end)).toBe(true)
    expect(inSelection(3, 2, start, end)).toBe(false)
    expect(inSelection(0, 5, start, end)).toBe(false)
  })

  it('handles a single-row range', () => {
    expect(inSelection(2, 4, { x: 4, y: 2 }, { x: 6, y: 2 })).toBe(true)
    expect(inSelection(2, 6, { x: 4, y: 2 }, { x: 6, y: 2 })).toBe(false)
  })
})

describe('rowSignature', () => {
  it('changes with text, style and extras', () => {
    const a = rowSignature(buildRuns(cells('مر'), null), 'rtl')
    expect(rowSignature(buildRuns(cells('مر'), null), 'rtl')).toBe(a)
    expect(rowSignature(buildRuns(cells('مرح'), null), 'rtl')).not.toBe(a)
    expect(rowSignature(buildRuns(cells('مر', { ...PLAIN_STYLE, bold: true }), null), 'rtl')).not.toBe(a)
    expect(rowSignature(buildRuns(cells('مر'), null), 'ltr')).not.toBe(a)
  })
})

// One cell per grapheme, as xterm stores a base letter together with its harakat.
const graphemeCells = (text: string, style = PLAIN_STYLE): RowCell[] =>
  [...new Intl.Segmenter('ar', { granularity: 'grapheme' }).segment(text)].map(({ segment }) => ({ chars: segment, width: 1, style }))

const shape = (segments: readonly Segment[]): { rtl: boolean; text: string }[] =>
  segments.map((segment) => ({ rtl: segment.rtl, text: runsText(segment.runs) }))

describe('textOrderFor', () => {
  it('treats Claude Code rows as visual order and everything else as logical', () => {
    expect(textOrderFor('claude')).toBe('visual')
    for (const agent of ['codex', 'gemini', 'shell', undefined]) expect(textOrderFor(agent)).toBe('logical')
  })
})

describe('visualSegments', () => {
  // Rows exactly as Claude Code 2.1 wrote them to the pty for the reply 'مَرْحَبًا بالعالم 42 develop يا صديقي'
  // and the typed prompt 'مساء الخير abc'.
  it('turns each Arabic stretch of a Claude reply back into reading order and keeps numbers and Latin words in place', () => {
    expect(shape(visualSegments(graphemeCells('يقيدص اي develop 42 ملاعلاب ابًحَرْمَ'), null))).toEqual([
      { rtl: true, text: 'يا صديقي' },
      { rtl: false, text: ' develop 42 ' },
      { rtl: true, text: 'مَرْحَبًا بالعالم' }
    ])
    expect(shape(visualSegments(graphemeCells(' abc ريخلا ءاسم'), null))).toEqual([
      { rtl: false, text: ' abc ' },
      { rtl: true, text: 'مساء الخير' }
    ])
  })

  it('keeps sentence punctuation inside a stretch but splits at digits and brackets', () => {
    expect(shape(visualSegments(graphemeCells('اركش .ابحرم'), null))).toEqual([{ rtl: true, text: 'مرحبا. شكرا' }])
    expect(shape(visualSegments(graphemeCells('فلم 42 ددع'), null))).toEqual([
      { rtl: true, text: 'ملف' },
      { rtl: false, text: ' 42 ' },
      { rtl: true, text: 'عدد' }
    ])
    expect(shape(visualSegments(graphemeCells('(صن)'), null))).toEqual([
      { rtl: false, text: '(' },
      { rtl: true, text: 'نص' },
      { rtl: false, text: ')' }
    ])
  })

  it('carries styles and the cursor into the reversed stretch', () => {
    const bold = { ...PLAIN_STYLE, bold: true }
    const row = [...graphemeCells('ريخلا', bold), ...graphemeCells(' ءاسم')]
    const segments = visualSegments(row, 0)
    expect(segments).toHaveLength(1)
    const runs = segments[0].runs
    expect(runs.map((run) => run.text)).toEqual(['مساء ', 'الخي', 'ر'])
    expect(runs[1].style.bold).toBe(true)
    expect(runs[2].style.cursor).toBe(true)
  })

  it('leaves a row without Arabic as one left-to-right stretch', () => {
    expect(shape(visualSegments(cells('● done 42'), null))).toEqual([{ rtl: false, text: '● done 42' }])
  })
})
