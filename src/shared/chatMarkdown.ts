import { parseInline, type Inline } from './chatMarkdownInline'
import { parseTable, tableAt, type TableBlock } from './chatMarkdownTable'

export type { Inline } from './chatMarkdownInline'
export type { TableAlign, TableBlock } from './chatMarkdownTable'

export interface ListItem {
  inline: Inline[]
  /** Lists nested under this item by indent. */
  children: ListBlock[]
}

export interface ListBlock {
  type: 'list'
  ordered: boolean
  /** The number the first item shows, so a list split by a code block keeps counting. */
  start: number
  items: ListItem[]
}

export type Block =
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inline: Inline[] }
  | { type: 'code'; text: string; lang: string }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'rule' }
  | ListBlock
  | TableBlock

const FENCE = /^\s*```\s*([\w+#.-]*)/
const FENCE_END = /^\s*```\s*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const QUOTE_DEPTH_MAX = 4
const TAB = '    '

interface Entry {
  indent: number
  ordered: boolean
  number: number
  text: string
}

function listEntry(line: string): Entry | null {
  const match = LIST.exec(line.replace(/\t/g, TAB))
  if (!match) return null
  const ordered = /\d/.test(match[2])
  return { indent: match[1].length, ordered, number: ordered ? parseInt(match[2], 10) : 0, text: match[3] }
}

/** Builds one list from entries in order, putting deeper-indented entries under the item above them. */
function buildList(entries: readonly Entry[], cursor: { at: number }): ListBlock {
  const first = entries[cursor.at]
  const items: ListItem[] = []
  while (cursor.at < entries.length) {
    const entry = entries[cursor.at]
    if (entry.indent < first.indent) break
    if (entry.indent > first.indent && items.length > 0) {
      const last = items[items.length - 1]
      items[items.length - 1] = { ...last, children: [...last.children, buildList(entries, cursor)] }
      continue
    }
    if (entry.ordered !== first.ordered) break
    items.push({ inline: parseInline(entry.text), children: [] })
    cursor.at += 1
  }
  return { type: 'list', ordered: first.ordered, start: first.number, items }
}

function listBlocks(entries: readonly Entry[]): ListBlock[] {
  const cursor = { at: 0 }
  const lists: ListBlock[] = []
  while (cursor.at < entries.length) lists.push(buildList(entries, cursor))
  return lists
}

/** Reads list lines from `from`: items, their wrapped continuation lines, and blank lines that sit between items. */
function readList(lines: readonly string[], from: number): { entries: Entry[]; next: number } {
  const entries: Entry[] = []
  let at = from
  while (at < lines.length) {
    const line = lines[at]
    const entry = listEntry(line)
    if (entry) {
      entries.push(entry)
    } else if (line.trim() === '') {
      if (!listEntry(lines[at + 1] ?? '')) break
    } else if (/^\s+\S/.test(line) && entries.length > 0 && !FENCE.test(line) && !QUOTE.test(line)) {
      const last = entries[entries.length - 1]
      entries[entries.length - 1] = { ...last, text: `${last.text}\n${line.trim()}` }
    } else {
      break
    }
    at += 1
  }
  return { entries, next: at }
}

function readQuote(lines: readonly string[], from: number): { inner: string[]; next: number } {
  const inner: string[] = []
  let at = from
  for (; at < lines.length; at += 1) {
    const match = QUOTE.exec(lines[at])
    if (!match) break
    inner.push(match[1])
  }
  return { inner, next: at }
}

function readFence(lines: readonly string[], from: number): { block: Block; next: number } {
  const lang = FENCE.exec(lines[from])?.[1] ?? ''
  const body: string[] = []
  let at = from + 1
  for (; at < lines.length && !FENCE_END.test(lines[at]); at += 1) body.push(lines[at])
  return { block: { type: 'code', text: body.join('\n'), lang }, next: at + 1 }
}

/**
 * Splits a message into blocks: paragraphs, headings, fenced code, lists (nested by indent), quotes, tables and rules.
 * Pure and never throws; text it does not recognise stays a paragraph. Nothing here is HTML.
 */
export function parseMarkdown(text: string, depth = 0): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join('\n')) })
    paragraph = []
  }
  let at = 0
  while (at < lines.length) {
    const line = lines[at]
    const heading = HEADING.exec(line)
    if (FENCE.test(line)) {
      flush()
      const fenced = readFence(lines, at)
      blocks.push(fenced.block)
      at = fenced.next
    } else if (heading) {
      flush()
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, inline: parseInline(heading[2]) })
      at += 1
    } else if (RULE.test(line)) {
      flush()
      blocks.push({ type: 'rule' })
      at += 1
    } else if (tableAt(lines, at)) {
      flush()
      const table = parseTable(lines, at)
      blocks.push(table.block)
      at = table.next
    } else if (QUOTE.test(line) && depth < QUOTE_DEPTH_MAX) {
      flush()
      const { inner, next } = readQuote(lines, at)
      blocks.push({ type: 'quote', blocks: parseMarkdown(inner.join('\n'), depth + 1) })
      at = next
    } else if (listEntry(line)) {
      flush()
      const { entries, next } = readList(lines, at)
      blocks.push(...listBlocks(entries))
      at = next
    } else {
      if (line.trim() === '') flush()
      else paragraph.push(line)
      at += 1
    }
  }
  flush()
  return blocks
}
