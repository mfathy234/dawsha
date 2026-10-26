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

function touched(starts: number[], from: number, to: number, into: Set<number>): void {
  if (to <= from) return
  for (let line = lineOf(starts, from); line <= lineOf(starts, to - 1); line += 1) into.add(line)
}

/** Lines added and removed between a base text and the current one, for the "+14 -3 since main" status. */
export function diffStat(base: string | null, text: string): DiffStat {
  const before = base ?? ''
  const a = lineStarts(before)
  const b = lineStarts(text)
  const added = new Set<number>()
  const removed = new Set<number>()
  for (const change of diff(before, text)) {
    touched(a, change.fromA, change.toA, removed)
    touched(b, change.fromB, change.toB, added)
  }
  return { added: added.size, removed: removed.size }
}
