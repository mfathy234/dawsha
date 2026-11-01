/** A run of changed lines. Starts and ends are 0-based line indexes, end exclusive. */
export interface LineChange {
  baseStart: number
  baseEnd: number
  curStart: number
  curEnd: number
}

export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** The hunk exactly as `git diff --unified=3` prints it, header line included. */
  text: string
  /** 1-based first and last line of the hunk's changes in the current file. */
  firstLine: number
  lastLine: number
  added: number
  removed: number
  /** The changes in this hunk, in the current file's line numbers. */
  changes: readonly LineChange[]
}

const CONTEXT = 3
const FUNC_START = /^[A-Za-z_$]/
const FUNC_MAX = 80

const range = (start: number, length: number): string => (length === 1 ? `${start}` : `${start},${length}`)
const startOf = (index: number, length: number): number => (length === 0 ? index : index + 1)

/** The text git puts after the second @@: the nearest earlier line of the old file that starts with a letter, _ or $. */
function funcContext(base: readonly string[], before: number): string {
  for (let index = Math.min(before, base.length) - 1; index >= 0; index -= 1) {
    if (FUNC_START.test(base[index])) return ` ${base[index].slice(0, FUNC_MAX).replace(/\s+$/, '')}`
  }
  return ''
}

function groupChanges(changes: readonly LineChange[]): LineChange[][] {
  const groups: LineChange[][] = []
  for (const change of changes) {
    const last = groups[groups.length - 1]
    const previous = last?.[last.length - 1]
    if (last && previous && change.curStart - previous.curEnd <= CONTEXT * 2) last.push(change)
    else groups.push([change])
  }
  return groups
}

function hunkOf(group: readonly LineChange[], base: readonly string[], cur: readonly string[], eol: string): Hunk {
  const first = group[0]
  const last = group[group.length - 1]
  const lead = Math.min(CONTEXT, first.curStart)
  const trail = Math.min(CONTEXT, cur.length - last.curEnd)
  const baseFrom = first.baseStart - lead
  const curFrom = first.curStart - lead
  const body: string[] = []
  let baseAt = baseFrom
  let curAt = curFrom
  let added = 0
  let removed = 0
  const context = (until: number): void => {
    for (; curAt < until; curAt += 1, baseAt += 1) body.push(` ${cur[curAt]}${eol}`)
  }
  for (const change of group) {
    context(change.curStart)
    for (let index = change.baseStart; index < change.baseEnd; index += 1) body.push(`-${base[index]}${eol}`)
    for (let index = change.curStart; index < change.curEnd; index += 1) body.push(`+${cur[index]}${eol}`)
    removed += change.baseEnd - change.baseStart
    added += change.curEnd - change.curStart
    baseAt = change.baseEnd
    curAt = change.curEnd
  }
  context(last.curEnd + trail)
  const oldLines = baseAt - baseFrom
  const newLines = curAt - curFrom
  const oldStart = startOf(baseFrom, oldLines)
  const newStart = startOf(curFrom, newLines)
  const header = `@@ -${range(oldStart, oldLines)} +${range(newStart, newLines)} @@${funcContext(base, baseFrom)}\n`
  return {
    oldStart, oldLines, newStart, newLines, text: header + body.join(''), added, removed, changes: group,
    firstLine: first.curStart + 1, lastLine: Math.max(last.curEnd, first.curStart + 1)
  }
}

/**
 * The hunks git would print for these changes. Lines are without their line ending, which is `eol` for all of them.
 * Returns none when the changes do not rebuild the file from its base, so a wrong patch is never offered.
 */
export function buildHunks(base: readonly string[], cur: readonly string[], changes: readonly LineChange[], eol: string): Hunk[] {
  if (!rebuilds(base, cur, changes)) return []
  return groupChanges(changes).map((group) => hunkOf(group, base, cur, eol))
}

function rebuilds(base: readonly string[], cur: readonly string[], changes: readonly LineChange[]): boolean {
  let baseAt = 0
  let curAt = 0
  for (const change of changes) {
    if (change.baseStart < baseAt || change.curStart < curAt || change.baseEnd < change.baseStart || change.curEnd < change.curStart) return false
    if (change.baseStart - baseAt !== change.curStart - curAt) return false
    for (let index = 0; index < change.baseStart - baseAt; index += 1) if (base[baseAt + index] !== cur[curAt + index]) return false
    baseAt = change.baseEnd
    curAt = change.curEnd
  }
  return base.length - baseAt === cur.length - curAt && base.slice(baseAt).every((line, index) => line === cur[curAt + index])
}

/** "line 12" or "lines 12 to 15": how the confirmation names a change. */
export function lineSpan(hunk: Pick<Hunk, 'firstLine' | 'lastLine'>): string {
  return hunk.lastLine > hunk.firstLine ? `lines ${hunk.firstLine} to ${hunk.lastLine}` : `line ${hunk.firstLine}`
}

/** The change a gutter row belongs to: the hunk whose changes include the line. */
export function hunkAtLine(hunks: readonly Hunk[], line: number): Hunk | null {
  return hunks.find((hunk) => hunk.changes.some((change) => line >= change.curStart + 1 && line <= Math.max(change.curEnd, change.curStart + 1))) ?? null
}

export interface ChunkSpan {
  fromA: number
  toA: number
  fromB: number
  toB: number
}

interface Lined {
  lineAt(pos: number): { number: number }
}

/** The changes as line runs: the merge view reports character offsets, and a run of whole lines ends after its last line break. */
export function changesOf(chunks: readonly ChunkSpan[], base: Lined, cur: Lined): LineChange[] {
  const startOf = (doc: Lined, pos: number): number => doc.lineAt(pos).number - 1
  const endOf = (doc: Lined, from: number, to: number): number => (to > from ? doc.lineAt(to - 1).number : startOf(doc, from))
  return chunks.map((chunk) => ({
    baseStart: startOf(base, chunk.fromA), baseEnd: endOf(base, chunk.fromA, chunk.toA),
    curStart: startOf(cur, chunk.fromB), curEnd: endOf(cur, chunk.fromB, chunk.toB)
  }))
}

/** The lines of a text without the empty one a final line break leaves, and whether there was a final line break. */
export function textLines(text: string, eol: string): { lines: string[]; finalNewline: boolean } {
  if (text === '') return { lines: [], finalNewline: false }
  const lines = text.split(eol)
  const finalNewline = lines[lines.length - 1] === ''
  if (finalNewline) lines.pop()
  return { lines, finalNewline }
}
