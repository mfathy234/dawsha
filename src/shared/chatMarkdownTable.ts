import { parseInline, type Inline } from './chatMarkdownInline'

export type TableAlign = 'left' | 'center' | 'right' | null

export interface TableBlock {
  type: 'table'
  align: TableAlign[]
  head: Inline[][]
  rows: Inline[][][]
}

const SEPARATOR_CELL = /^:?-+:?$/
const COLUMNS_MAX = 24
const ROWS_MAX = 200

/** Splits one table line on pipes that are not escaped and not inside `code`. */
export function splitRow(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let code = false
  for (let at = 0; at < line.length; at += 1) {
    const char = line[at]
    if (char === '\\' && line[at + 1] === '|') {
      cell += '|'
      at += 1
    } else if (char === '`') {
      code = !code
      cell += char
    } else if (char === '|' && !code) {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell)
  const trimmed = cells.map((value) => value.trim())
  if (line.trim().startsWith('|')) trimmed.shift()
  if (line.trim().endsWith('|') && !line.trim().endsWith('\\|')) trimmed.pop()
  return trimmed
}

function separatorAlign(line: string): TableAlign[] | null {
  if (!line.includes('-') || line.trim() === '') return null
  const cells = splitRow(line)
  if (cells.length === 0 || !cells.every((cell) => SEPARATOR_CELL.test(cell))) return null
  return cells.map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null
  })
}

/** A table starts at a header line with pipes whose next line is a separator row with the same number of columns. */
export function tableAt(lines: readonly string[], at: number): boolean {
  const head = lines[at]
  const separator = lines[at + 1]
  if (head === undefined || separator === undefined || !head.includes('|')) return false
  const align = separatorAlign(separator)
  return align !== null && align.length === splitRow(head).length && align.length <= COLUMNS_MAX
}

/** Reads the table at `at`; rows run until a blank line or a line without a pipe. Short rows are padded, long ones cut. */
export function parseTable(lines: readonly string[], at: number): { block: TableBlock; next: number } {
  const align = separatorAlign(lines[at + 1]) ?? []
  const width = align.length
  const cell = (text: string | undefined): Inline[] => parseInline(text ?? '')
  const head = splitRow(lines[at]).map((text) => cell(text))
  const rows: Inline[][][] = []
  let next = at + 2
  while (next < lines.length && lines[next].trim() !== '' && lines[next].includes('|') && rows.length < ROWS_MAX) {
    const values = splitRow(lines[next])
    rows.push(Array.from({ length: width }, (_, column) => cell(values[column])))
    next += 1
  }
  return { block: { type: 'table', align, head, rows }, next }
}
