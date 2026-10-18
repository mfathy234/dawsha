// Pure logic behind the Arabic overlay: spotting rows that need shaping/BiDi and turning a row's cells into styled runs.
// The terminal buffer stays in logical order; the overlay only reads it.

export const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/

export const hasArabic = (text: string): boolean => ARABIC_RE.test(text)

export type Direction = 'rtl' | 'ltr'

// Arabic-Indic digits and number signs are weak in the Unicode BiDi algorithm, so they never set the direction.
const WEAK_ARABIC_RE = /[؀-؅٠-٬۝۰-۹࣢]/
const STRONG_ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/
const STRONG_LTR_RE = /\p{L}/u

/** Paragraph direction from the first strong character of the row (rows without a strong character are LTR). */
export function paragraphDirection(text: string): Direction {
  for (const char of text) {
    if (WEAK_ARABIC_RE.test(char)) continue
    if (STRONG_ARABIC_RE.test(char)) return 'rtl'
    if (STRONG_LTR_RE.test(char)) return 'ltr'
  }
  return 'ltr'
}

export interface CellStyle {
  fg: string | null
  bg: string | null
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  dim: boolean
  selected: boolean
  cursor: boolean
}

export const PLAIN_STYLE: CellStyle = {
  fg: null,
  bg: null,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  dim: false,
  selected: false,
  cursor: false
}

export interface RowCell {
  chars: string
  width: number
  style: CellStyle
}

export interface Run {
  text: string
  style: CellStyle
}

export const sameStyle = (a: CellStyle, b: CellStyle): boolean =>
  a.fg === b.fg &&
  a.bg === b.bg &&
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.strike === b.strike &&
  a.dim === b.dim &&
  a.selected === b.selected &&
  a.cursor === b.cursor

const isBlank = (cell: RowCell): boolean =>
  (cell.chars === '' || cell.chars === ' ') && cell.width > 0 && sameStyle({ ...cell.style, selected: false }, PLAIN_STYLE)

/** One glyph per column (a cell's base character with its combining marks), in column order. */
function rowGlyphs(cells: readonly RowCell[], cursorX: number | null): Run[] {
  let end = cells.length
  while (end > 0 && isBlank(cells[end - 1])) end -= 1
  const cursor = cursorX !== null && cursorX >= 0 ? cursorX : null
  if (cursor !== null) end = Math.max(end, cursor + 1)
  const glyphs: Run[] = []
  for (let x = 0; x < end; x += 1) {
    const cell = cells[x]
    const atCursor = x === cursor
    if (!cell) {
      glyphs.push({ text: ' ', style: { ...PLAIN_STYLE, cursor: atCursor } })
      continue
    }
    if (cell.width === 0) continue
    glyphs.push({ text: cell.chars === '' ? ' ' : cell.chars, style: atCursor ? { ...cell.style, cursor: true } : cell.style })
  }
  return glyphs
}

/** Joins neighbouring glyphs that share a style into one run. */
function mergeRuns(glyphs: readonly Run[]): Run[] {
  const runs: Run[] = []
  for (const glyph of glyphs) {
    const last = runs[runs.length - 1]
    if (last && sameStyle(last.style, glyph.style)) runs[runs.length - 1] = { text: last.text + glyph.text, style: glyph.style }
    else runs.push(glyph)
  }
  return runs
}

/**
 * Cells (one entry per column, wide characters followed by a width-0 cell) to runs of text sharing one style.
 * Trailing blank cells are dropped, except up to the cursor column, which is marked so the overlay can draw a caret.
 */
export const buildRuns = (cells: readonly RowCell[], cursorX: number | null): Run[] => mergeRuns(rowGlyphs(cells, cursorX))

/**
 * How a program writes right-to-left text. Most write it in logical (reading) order and leave BiDi to the terminal.
 * Claude Code runs the BiDi algorithm itself and writes rows already in visual left-to-right order, unshaped.
 */
export type TextOrder = 'logical' | 'visual'

export const textOrderFor = (agent: string | undefined): TextOrder => (agent === 'claude' ? 'visual' : 'logical')

/** A stretch of a visual-order row: `rtl` stretches hold their glyphs back in logical order, to be drawn right-to-left. */
export interface Segment {
  rtl: boolean
  runs: Run[]
}

// Characters that stay inside a right-to-left stretch when they sit between two Arabic glyphs. Brackets are left out:
// the program has already mirrored them, and drawing them right-to-left would mirror them again.
const JOINING_NEUTRAL_RE = /^[\s.,!?:;'"\-_*/\\|~@#&=+%^…]+$/

type GlyphKind = 'arabic' | 'neutral' | 'other'

function glyphKind(text: string): GlyphKind {
  if (hasArabic(text) && !WEAK_ARABIC_RE.test(text[0])) return 'arabic'
  return JOINING_NEUTRAL_RE.test(text) ? 'neutral' : 'other'
}

/**
 * Splits a row written in visual order into left-to-right stretches and Arabic stretches. Each Arabic stretch has its
 * glyphs reversed back to reading order, so the browser can join the letters and lay them out right-to-left again,
 * landing where the program placed them. Digits, Latin words and brackets stay in the left-to-right stretches.
 */
export function visualSegments(cells: readonly RowCell[], cursorX: number | null): Segment[] {
  const glyphs = rowGlyphs(cells, cursorX)
  const kinds = glyphs.map((glyph) => glyphKind(glyph.text))
  const segments: Segment[] = []
  let x = 0
  while (x < glyphs.length) {
    let end = x + 1
    if (kinds[x] === 'arabic') {
      let last = x
      while (end < glyphs.length && kinds[end] !== 'other') {
        if (kinds[end] === 'arabic') last = end
        end += 1
      }
      segments.push({ rtl: true, runs: mergeRuns(glyphs.slice(x, last + 1).reverse()) })
      x = last + 1
      continue
    }
    while (end < glyphs.length && kinds[end] !== 'arabic') end += 1
    segments.push({ rtl: false, runs: mergeRuns(glyphs.slice(x, end)) })
    x = end
  }
  return segments
}

/** Text of the runs in logical order. */
export const runsText = (runs: readonly Run[]): string => runs.map((run) => run.text).join('')

const CUBE_STEPS = [0, 95, 135, 175, 215, 255]
const hex2 = (value: number): string => value.toString(16).padStart(2, '0')

/** CSS color for a 256-color palette index; 0-15 come from the theme's `ansi` list. */
export function paletteColor(index: number, ansi: readonly string[]): string {
  if (index < 16) return ansi[index] ?? '#ffffff'
  if (index < 232) {
    const n = index - 16
    return `#${hex2(CUBE_STEPS[Math.floor(n / 36)])}${hex2(CUBE_STEPS[Math.floor(n / 6) % 6])}${hex2(CUBE_STEPS[n % 6])}`
  }
  const level = 8 + (index - 232) * 10
  return `#${hex2(level)}${hex2(level)}${hex2(level)}`
}

export const rgbColor = (value: number): string =>
  `#${hex2((value >> 16) & 255)}${hex2((value >> 8) & 255)}${hex2(value & 255)}`

/** Whether the half-open selection [start, end) in (row, col) order covers the cell. Positions are 0-based. */
export function inSelection(
  row: number,
  col: number,
  start: { x: number; y: number },
  end: { x: number; y: number }
): boolean {
  if (row < start.y || row > end.y) return false
  if (start.y === end.y) return col >= start.x && col < end.x
  if (row === start.y) return col >= start.x
  if (row === end.y) return col < end.x
  return true
}

/** Cheap identity of a row's drawing, so an unchanged row is not rebuilt. */
export function rowSignature(runs: readonly Run[], extra: string): string {
  const parts = runs.map((r) => {
    const s = r.style
    const flags = (s.bold ? 'b' : '') + (s.italic ? 'i' : '') + (s.underline ? 'u' : '') + (s.strike ? 's' : '') + (s.dim ? 'd' : '') + (s.selected ? 'x' : '') + (s.cursor ? 'c' : '')
    return `${s.fg ?? ''}|${s.bg ?? ''}|${flags}|${r.text}`
  })
  return `${extra}#${parts.join('\u0001')}`
}
