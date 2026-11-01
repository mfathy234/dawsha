import type { DiffHunk } from './gitHunks'

interface PatchLine { kind: string; text: string; newline: boolean; crlf: boolean }
const ending = (line: string): string => line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : ''
const content = (line: string): string => line.slice(0, line.length - ending(line).length)

/** Reverse only the selected lines, retaining the original bytes of every context/outside line. */
export function reverseHunk(text: string, hunk: DiffHunk): string | null {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const patch: PatchLine[] = []
  const body = hunk.text.split('\n').slice(1)
  if (body.at(-1) === '') body.pop()
  for (const line of body) {
    if (line === '\\ No newline at end of file') {
      if (!patch.length) return null
      const previous = patch[patch.length - 1]
      previous.newline = false
      // Without LF, a trailing CR belongs to the content rather than a CRLF ending.
      if (previous.crlf) previous.text += '\r'
      previous.crlf = false
    } else {
      if (![' ', '+', '-'].includes(line[0])) return null
      const value = line.slice(1)
      patch.push({ kind: line[0], text: value.replace(/\r$/, ''), newline: true, crlf: value.endsWith('\r') })
    }
  }
  const start = hunk.coordinates.newLines ? hunk.coordinates.newStart - 1 : hunk.coordinates.newStart
  if (start < 0 || start > lines.length) return null
  // The generated diff already reflects Git's per-file attributes/autocrlf rules.
  // Only infer working-file endings when Git actually stripped CR from a source
  // row; otherwise each removed row's ending is literal and must be restored.
  const sourceRows = patch.filter(row => row.kind !== '-')
  const normalized = sourceRows.some((row, index) => row.newline && !row.crlf && ending(lines[start + index] ?? '') === '\r\n')
  const out: string[] = []
  let cursor = start
  let oldCount = 0
  const consume = (row: PatchLine): string | null => {
    const line = lines[cursor]
    if (line === undefined || content(line) !== row.text || Boolean(ending(line)) !== row.newline) return null
    cursor++
    return line
  }
  for (let index = 0; index < patch.length;) {
    const row = patch[index]
    if (row.kind === ' ') {
      const line = consume(row)
      if (line === null) return null
      out.push(line)
      oldCount++
      index++
      continue
    }
    const removed: PatchLine[] = []
    const added: string[] = []
    while (index < patch.length && patch[index].kind !== ' ') {
      const change = patch[index++]
      if (change.kind === '-') removed.push(change)
      else {
        const line = consume(change)
        if (line === null) return null
        added.push(line)
      }
    }
    const nearbyEnding = added.map(ending).find(Boolean) || ending(lines[cursor] ?? '') || ending(lines[cursor - 1] ?? '') || '\n'
    for (let offset = 0; offset < removed.length; offset++) {
      const old = removed[offset]
      const eol = old.crlf ? '\r\n' : normalized ? ending(added[offset] ?? '') || nearbyEnding : '\n'
      out.push(old.text + (old.newline ? eol : ''))
    }
    oldCount += removed.length
  }
  if (cursor - start !== hunk.coordinates.newLines || oldCount !== hunk.coordinates.oldLines) return null
  return lines.slice(0, start).join('') + out.join('') + lines.slice(cursor).join('')
}
