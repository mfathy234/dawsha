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

/**
 * Cells (one entry per column, wide characters followed by a width-0 cell) to runs of text sharing one style.
 * Trailing blank cells are dropped, except up to the cursor column, which is marked so the overlay can draw a caret.
 */
export function buildRuns(cells: readonly RowCell[], cursorX: number | null): Run[] {
  let end = cells.length
  while (end > 0 && isBlank(cells[end - 1])) end -= 1
  const cursor = cursorX !== null && cursorX >= 0 ? cursorX : null
  if (cursor !== null) end = Math.max(end, cursor + 1)
  const runs: Run[] = []
  const push = (text: string, style: CellStyle): void => {
    const last = runs[runs.length - 1]
    if (last && sameStyle(last.style, style)) runs[runs.length - 1] = { text: last.text + text, style }
    else runs.push({ text, style })
  }
  for (let x = 0; x < end; x += 1) {
    const cell = cells[x]
    const atCursor = x === cursor
    if (!cell) {
      push(' ', { ...PLAIN_STYLE, cursor: atCursor })
      continue
    }
    if (cell.width === 0) continue
    const style = atCursor ? { ...cell.style, cursor: true } : cell.style
    push(cell.chars === '' ? ' ' : cell.chars, style)
  }
  return runs
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
