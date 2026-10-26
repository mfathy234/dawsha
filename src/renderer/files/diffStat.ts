import { diff } from '@codemirror/merge'

export interface DiffStat {
  added: number
  removed: number
}

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

function lineOf(starts: number[], pos: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid] <= pos) low = mid
    else high = mid - 1
  }
  return low
}

const atLineStart = (starts: number[], pos: number): boolean => starts[lineOf(starts, pos)] === pos

// A range made of whole lines (or empty at a line start); anything else changes part of a line.
function wholeLines(starts: number[], length: number, from: number, to: number): boolean {
  return atLineStart(starts, from) && (to === length || atLineStart(starts, to))
}

function touched(starts: number[], from: number, to: number, whole: boolean, into: Set<number>): void {
  if (whole && to <= from) return
  const last = to > from ? lineOf(starts, to - 1) : lineOf(starts, from)
  for (let line = lineOf(starts, from); line <= last; line += 1) into.add(line)
}

/** Lines added and removed between a base text and the current one, counted the way the Changes view shows them: a line edited in place is one removed and one added. */
export function diffStat(base: string | null, text: string): DiffStat {
  const before = base ?? ''
  const a = lineStarts(before)
  const b = lineStarts(text)
  const added = new Set<number>()
  const removed = new Set<number>()
  for (const change of diff(before, text)) {
    const whole = wholeLines(a, before.length, change.fromA, change.toA) && wholeLines(b, text.length, change.fromB, change.toB)
    touched(a, change.fromA, change.toA, whole, removed)
    touched(b, change.fromB, change.toB, whole, added)
  }
  return { added: added.size, removed: removed.size }
}
