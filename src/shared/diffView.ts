// Turns a unified diff into rows for a side-by-side or unified view. Pure, so it is unit tested.

export type LineKind = 'context' | 'add' | 'del'

export interface DiffLine {
  kind: LineKind
  oldNo: number | null
  newNo: number | null
  text: string
}

export interface Hunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

// Character range [start, end) inside a line that changed within a modified line pair.
export type Range = [number, number]

export interface Side {
  no: number
  text: string
  kind: LineKind
  marks: Range[]
}

export interface SplitRow {
  left: Side | null
  right: Side | null
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function parseUnifiedDiff(text: string): Hunk[] {
  const hunks: Hunk[] = []
  let current: Hunk | null = null
  let oldNo = 0
  let newNo = 0
  for (const raw of text.split('\n')) {
    const header = HUNK.exec(raw)
    if (header) {
      oldNo = Number(header[1])
      newNo = Number(header[3])
      current = {
        oldStart: oldNo,
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: newNo,
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        lines: []
      }
      hunks.push(current)
      continue
    }
    if (!current || raw.startsWith('\\')) continue
    const sign = raw[0]
    const body = raw.slice(1).replace(/\r$/, '')
    if (sign === '+') current.lines.push({ kind: 'add', oldNo: null, newNo: newNo++, text: body })
    else if (sign === '-') current.lines.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: body })
    else if (sign === ' ' || raw === '') {
      // The empty string after a diff's last newline is not a line of the hunk.
      if (raw === '' && oldNo >= current.oldStart + current.oldCount && newNo >= current.newStart + current.newCount) continue
      current.lines.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text: body })
    }
  }
  return hunks
}

// The changed middle of two similar lines: everything between their shared start and shared end.
export function changedRanges(before: string, after: string): { before: Range[]; after: Range[] } {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1
    endAfter -= 1
  }
  // Lines that share almost nothing are a rewrite: tint them whole instead of marking every character.
  const shared = start + (before.length - endBefore)
  if (shared < Math.min(before.length, after.length) * 0.2) return { before: [], after: [] }
  return {
    before: endBefore > start ? [[start, endBefore]] : [],
    after: endAfter > start ? [[start, endAfter]] : []
  }
}

// Pairs each run of removed lines with the added lines that follow it, row by row.
export function splitRows(hunk: Hunk): SplitRow[] {
  const rows: SplitRow[] = []
  const lines = hunk.lines
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line.kind === 'context') {
      rows.push({
        left: { no: line.oldNo as number, text: line.text, kind: 'context', marks: [] },
        right: { no: line.newNo as number, text: line.text, kind: 'context', marks: [] }
      })
      index += 1
      continue
    }
    const removed: DiffLine[] = []
    const added: DiffLine[] = []
    while (index < lines.length && lines[index].kind === 'del') removed.push(lines[index++])
    while (index < lines.length && lines[index].kind === 'add') added.push(lines[index++])
    const count = Math.max(removed.length, added.length)
    for (let row = 0; row < count; row += 1) {
      const left = removed[row]
      const right = added[row]
      const ranges = left && right ? changedRanges(left.text, right.text) : { before: [], after: [] }
      rows.push({
        left: left ? { no: left.oldNo as number, text: left.text, kind: 'del', marks: ranges.before } : null,
        right: right ? { no: right.newNo as number, text: right.text, kind: 'add', marks: ranges.after } : null
      })
    }
  }
  return rows
}

// Unchanged lines between two hunks (or before the first one), counted on the new side.
export function gapBefore(hunks: Hunk[], index: number): { from: number; to: number } | null {
  const hunk = hunks[index]
  const from = index === 0 ? 1 : hunks[index - 1].newStart + hunks[index - 1].newCount
  const to = hunk.newStart - 1
  return to >= from ? { from, to } : null
}

// New-file line numbers that were added or changed, for tinting a plain file view.
export function addedLines(text: string): Set<number> {
  const added = new Set<number>()
  for (const hunk of parseUnifiedDiff(text)) for (const line of hunk.lines) if (line.kind === 'add' && line.newNo !== null) added.add(line.newNo)
  return added
}

export function diffTotals(hunks: Hunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const hunk of hunks) for (const line of hunk.lines) {
    if (line.kind === 'add') added += 1
    else if (line.kind === 'del') removed += 1
  }
  return { added, removed }
}
