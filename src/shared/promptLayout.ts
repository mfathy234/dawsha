import { displayWidth } from './terminalText'

/** Where one character of the agent's input box sits on screen. */
export interface PromptCell {
  row: number
  col: number
}

/** The text typed in an agent's input box and the screen cell of each character of it. */
export interface PromptLayout {
  text: string
  cells: PromptCell[]
}

const RULE = /^\s*[─━═]{4,}\s*$/
const BOX_ROW = /^(\s*[│┃]\s?)(.*?)\s*[│┃]\s*$/
const MARKER = /^((?:[>❯›]|▌)\s*)/
const BARE_MARKER = /^[›▌]/

interface Span {
  row: number
  /** Column of the first character of `text`. */
  col: number
  text: string
}

function columnsOf(prefix: string): number {
  return displayWidth(prefix)
}

function boxSpans(rows: string[]): Span[] | null {
  for (let end = rows.length - 1; end >= 0; end -= 1) {
    if (!BOX_ROW.test(rows[end])) continue
    let start = end
    while (start > 0 && BOX_ROW.test(rows[start - 1])) start -= 1
    const spans: Span[] = []
    for (let row = start; row <= end; row += 1) {
      const [, border, inner] = BOX_ROW.exec(rows[row]) as RegExpExecArray
      const lead = row === start ? MARKER.exec(inner)?.[1] : /^ {0,2}/.exec(inner)?.[0]
      if (lead === undefined) break
      spans.push({ row, col: columnsOf(border + lead), text: inner.slice(lead.length) })
    }
    if (spans.length > 0) return spans
    end = start
  }
  return null
}

function composerSpans(rows: string[]): Span[] | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const line = rows[index].replace(/\s+$/, '')
    const lead = MARKER.exec(line)?.[1]
    const ruled = index > 0 && RULE.test(rows[index - 1])
    if (lead === undefined || !(ruled || BARE_MARKER.test(line))) continue
    const spans: Span[] = [{ row: index, col: columnsOf(lead), text: line.slice(lead.length) }]
    for (let next = index + 1; next < rows.length; next += 1) {
      const raw = rows[next].replace(/\s+$/, '')
      if (raw === '' || RULE.test(raw) || !raw.startsWith('  ')) break
      spans.push({ row: next, col: 2, text: raw.slice(2) })
    }
    return spans
  }
  return null
}

/**
 * Finds the agent's input box on screen. Rows wrapped by the agent are joined with a space, which is how the
 * agent itself counts them when the wrap fell between words.
 */
export function promptLayout(rows: string[], _cols: number): PromptLayout | null {
  const spans = boxSpans(rows) ?? composerSpans(rows)
  if (!spans) return null
  let text = ''
  const cells: PromptCell[] = []
  spans.forEach((span, index) => {
    if (index > 0 && text !== '' && span.text !== '') {
      const last = cells[cells.length - 1]
      text += ' '
      cells.push({ row: last.row, col: last.col + 1 })
    }
    let col = span.col
    for (const char of span.text) {
      text += char
      cells.push({ row: span.row, col })
      col += Math.max(1, displayWidth(char))
    }
  })
  const trimmed = text.replace(/\s+$/, '')
  if (trimmed === '') return null
  return { text: trimmed, cells: cells.slice(0, trimmed.length) }
}

const isSpace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char)

/** Start of the word before `from`: skip spaces, then the word, like Ctrl+Shift+Left in a text box. */
export function wordStartBefore(text: string, from: number): number {
  let index = from
  while (index > 0 && isSpace(text[index - 1])) index -= 1
  while (index > 0 && !isSpace(text[index - 1])) index -= 1
  return index
}

/** Moves the selection start forward by one word, giving it back; the end of the text means nothing is selected. */
export function shrinkSelection(text: string, start: number): number {
  let index = start
  while (index < text.length && !isSpace(text[index])) index += 1
  while (index < text.length && isSpace(text[index])) index += 1
  return index
}
