import type { IBufferCell, IBufferLine, ITheme, Terminal } from '@xterm/xterm'

export interface CellRun {
  text: string
  fg: string | null
  bg: string | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
}

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const

const CUBE = [0, 95, 135, 175, 215, 255]

const hex = (n: number): string => n.toString(16).padStart(2, '0')

export function paletteColor(index: number, theme: ITheme): string {
  if (index < 16) return theme[ANSI_KEYS[index]] ?? '#cccccc'
  if (index < 232) {
    const n = index - 16
    return `#${hex(CUBE[Math.floor(n / 36)])}${hex(CUBE[Math.floor(n / 6) % 6])}${hex(CUBE[n % 6])}`
  }
  const grey = 8 + (index - 232) * 10
  return `#${hex(grey)}${hex(grey)}${hex(grey)}`
}

function color(cell: IBufferCell, theme: ITheme, foreground: boolean): string | null {
  const isDefault = foreground ? cell.isFgDefault() : cell.isBgDefault()
  if (isDefault) return null
  const value = foreground ? cell.getFgColor() : cell.getBgColor()
  const rgb = foreground ? cell.isFgRGB() : cell.isBgRGB()
  if (rgb) return `#${hex((value >> 16) & 255)}${hex((value >> 8) & 255)}${hex(value & 255)}`
  return paletteColor(value, theme)
}

function sameStyle(a: CellRun, b: CellRun): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.dim === b.dim && a.italic === b.italic && a.underline === b.underline
}

/** One buffer row as runs of text that share colours and weight, resolved against the theme. */
export function rowRuns(line: IBufferLine, cols: number, theme: ITheme, trim: boolean): CellRun[] {
  const runs: CellRun[] = []
  let cell: IBufferCell | undefined
  for (let x = 0; x < cols; x += 1) {
    cell = line.getCell(x, cell)
    if (!cell) break
    if (cell.getWidth() === 0) continue
    const chars = cell.getChars() || ' '
    const inverse = cell.isInverse() !== 0
    const fg = color(cell, theme, !inverse)
    const bg = color(cell, theme, inverse)
    const run: CellRun = {
      text: chars,
      fg: inverse ? (fg ?? theme.background ?? null) : fg,
      bg: inverse ? (bg ?? theme.foreground ?? null) : bg,
      bold: cell.isBold() !== 0,
      dim: cell.isDim() !== 0,
      italic: cell.isItalic() !== 0,
      underline: cell.isUnderline() !== 0
    }
    const last = runs[runs.length - 1]
    if (last && sameStyle(last, run)) last.text += chars
    else runs.push(run)
  }
  if (trim && runs.length > 0) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '')
  return runs.filter((run) => run.text !== '')
}

/** The runs of a logical line: wrapped rows are joined and only the last row loses its trailing spaces. */
export function logicalRuns(term: Terminal, row: number, rows: number, theme: ITheme): CellRun[] {
  const buffer = term.buffer.active
  const runs: CellRun[] = []
  for (let at = row; at < row + rows; at += 1) {
    const line = buffer.getLine(at)
    if (!line) continue
    runs.push(...rowRuns(line, term.cols, theme, at === row + rows - 1))
  }
  return runs
}
