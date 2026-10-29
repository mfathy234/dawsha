import type { EditChange, EditPiece } from './editChange'

export interface LocatableEdit {
  at: number
  /** Absent when the transcript did not carry the edit's text. */
  change?: EditChange
}

export interface Located {
  /** Line (1-based, as the editor numbers them) to the index of the edit that wrote it. */
  owners: Map<number, number>
  /** Edits whose lines could not be told from the file, so the caller has to estimate them. */
  estimate: Set<number>
  /** How many lines each edit was placed on. */
  placed: Map<number, number>
}

const MAX_OCCURRENCES = 50
const ALIGN_WINDOW = 400

const normal = (text: string): string => text.replace(/\r\n/g, '\n')

function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = []
  let from = 0
  while (found.length < MAX_OCCURRENCES) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    found.push(at)
    from = at + Math.max(needle.length, 1)
  }
  return found
}

/**
 * Finds the lines each edit wrote by looking for the edit's new text in the file as it is now. Newest edits are placed
 * first, so text a later edit rewrote is not given to an earlier one. An edit whose text is gone was overwritten and gets
 * no lines; one with no text, or whose text matches in several places, is left to the caller's estimate.
 */
export function locateEdits(fileText: string, edits: readonly LocatableEdit[]): Located {
  const text = normal(fileText)
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1)
  const lineAt = (offset: number): number => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (starts[mid] <= offset) low = mid
      else high = mid - 1
    }
    return low + 1
  }
  const fileLines = text.split('\n')
  const owners = new Map<number, number>()
  const estimate = new Set<number>()
  const placed = new Map<number, number>()
  const deletedAt = edits.reduce((latest, edit) => (edit.change?.deleted ? Math.max(latest, edit.at) : latest), -Infinity)

  const claim = (index: number, from: number, to: number): boolean => {
    let any = false
    for (let line = from; line <= to; line += 1) {
      if (owners.has(line)) continue
      owners.set(line, index)
      placed.set(index, (placed.get(index) ?? 0) + 1)
      any = true
    }
    return any
  }
  const span = (offset: number, length: number): [number, number] | null => {
    let start = offset
    let end = offset + length - 1
    while (start <= end && text[start] === '\n') start += 1
    while (end >= start && text[end] === '\n') end -= 1
    return end < start ? null : [lineAt(start), lineAt(end)]
  }
  const free = (range: [number, number]): boolean => {
    for (let line = range[0]; line <= range[1]; line += 1) if (!owners.has(line)) return true
    return false
  }

  const place = (index: number, piece: EditPiece): 'placed' | 'gone' | 'unsure' => {
    const body = normal(piece.text)
    if (body.trim() === '') return 'placed'
    const around = piece.before !== undefined || piece.after !== undefined
    if (around) {
      const before = piece.before ? `${normal(piece.before)}\n` : ''
      const after = piece.after ? `\n${normal(piece.after)}` : ''
      const anchored = occurrences(text, `${before}${body}${after}`)
      if (anchored.length === 1) {
        const range = span(anchored[0] + before.length, body.length)
        if (range) claim(index, range[0], range[1])
        return 'placed'
      }
    }
    const spots = occurrences(text, body).map((at) => span(at, body.length)).filter((range): range is [number, number] => range !== null)
    const open = spots.filter(free)
    if (piece.all && spots.length > 0) {
      for (const range of spots) claim(index, range[0], range[1])
      return 'placed'
    }
    if (open.length === 1) {
      claim(index, open[0][0], open[0][1])
      return 'placed'
    }
    if (open.length > 1) return 'unsure'
    if (spots.length > 0) return 'placed'
    return 'gone'
  }

  const align = (index: number, piece: EditPiece): void => {
    const lines = normal(piece.text).split('\n')
    let pointer = 0
    for (const line of lines) {
      if (line.trim() === '') continue
      const stop = Math.min(fileLines.length, pointer + ALIGN_WINDOW)
      for (let at = pointer; at < stop; at += 1) {
        if (fileLines[at] !== line) continue
        claim(index, at + 1, at + 1)
        pointer = at + 1
        break
      }
    }
  }

  const order = edits.map((_, index) => index).sort((a, b) => edits[b].at - edits[a].at || b - a)
  for (const index of order) {
    const edit = edits[index]
    const change = edit.change
    if (!change) {
      estimate.add(index)
      continue
    }
    if (change.deleted || edit.at < deletedAt) continue
    let unsure = false
    for (const piece of change.pieces) {
      const outcome = place(index, piece)
      if (outcome === 'unsure') unsure = true
      else if (outcome === 'gone' && change.whole) align(index, piece)
    }
    if (unsure) estimate.add(index)
  }
  return { owners, estimate, placed }
}
