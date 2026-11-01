import type { OutlineItem } from './outline'

export interface LineTarget {
  line: number
  column: number | null
}

/** "12" or "12:5" in the Go to Line box. Null when it is not a position inside the file. */
export function parseLineInput(text: string, lineCount: number): LineTarget | null {
  const found = /^\s*(\d+)(?:\s*[:,]\s*(\d+))?\s*$/.exec(text)
  if (!found) return null
  const line = Number(found[1])
  if (line < 1 || line > lineCount) return null
  return { line, column: found[2] ? Math.max(1, Number(found[2])) : null }
}

/** Outline items whose name contains the query (case-insensitive), in file order. */
export function filterOutline(items: readonly OutlineItem[], query: string): OutlineItem[] {
  const needle = query.trim().toLowerCase()
  return needle === '' ? [...items] : items.filter((item) => item.name.toLowerCase().includes(needle))
}

/** The symbols the cursor is inside, outermost first: a class, then its method. Closing braces are not tracked, so a trailing gap still names the last one. */
export function enclosingSymbols(items: readonly OutlineItem[], line: number): OutlineItem[] {
  const chain: OutlineItem[] = []
  for (const item of items) {
    if (item.line > line) break
    chain.length = Math.min(chain.length, item.depth)
    chain[item.depth] = item
  }
  return chain.filter(Boolean)
}
