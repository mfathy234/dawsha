export type DiffKind = 'add' | 'del' | 'ctx' | 'gap'

export interface DiffLine {
  k: DiffKind
  /** The line number in the file: the new file for added and kept lines, the old file for removed ones. */
  n?: number
  t: string
}

export interface ChatDiff {
  lines: DiffLine[]
  /** Lines left out to keep the item small. */
  more: number
}

export const DIFF_LINES_MAX = 400
export const DIFF_LINE_CHARS = 300
/** A diff longer than this folds until it is opened. */
export const DIFF_FOLD_LINES = 24

const MARK: Readonly<Record<string, DiffKind>> = { '+': 'add', '-': 'del', ' ': 'ctx' }
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

const cut = (text: string): string => (text.length > DIFF_LINE_CHARS ? `${text.slice(0, DIFF_LINE_CHARS)}…` : text)

function bounded(lines: DiffLine[]): ChatDiff | null {
  if (lines.length === 0) return null
  return { lines: lines.slice(0, DIFF_LINES_MAX), more: Math.max(0, lines.length - DIFF_LINES_MAX) }
}

/** Walks marked lines (` `, `-`, `+`), numbering them from the hunk's start lines. */
function numbered(marked: readonly string[], oldStart: number | undefined, newStart: number | undefined): DiffLine[] {
  let oldNo = oldStart
  let newNo = newStart
  return marked.flatMap((raw): DiffLine[] => {
    const kind = MARK[raw[0] ?? ' '] ?? 'ctx'
    const t = cut(raw.slice(1))
    if (kind === 'del') {
      const line: DiffLine = { k: kind, t, ...(oldNo !== undefined ? { n: oldNo } : {}) }
      oldNo = oldNo === undefined ? undefined : oldNo + 1
      return [line]
    }
    const line: DiffLine = { k: kind, t, ...(newNo !== undefined ? { n: newNo } : {}) }
    newNo = newNo === undefined ? undefined : newNo + 1
    if (kind === 'ctx') oldNo = oldNo === undefined ? undefined : oldNo + 1
    return [line]
  })
}

const asNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined)

/** Claude's `structuredPatch`: hunks with their start lines. Null when it holds no hunk. */
export function diffFromStructuredPatch(patch: unknown): ChatDiff | null {
  if (!Array.isArray(patch)) return null
  const lines = patch.flatMap((hunk, index): DiffLine[] => {
    if (typeof hunk !== 'object' || hunk === null) return []
    const record = hunk as Record<string, unknown>
    const marked = Array.isArray(record.lines) ? record.lines.filter((line): line is string => typeof line === 'string') : []
    const body = numbered(marked, asNumber(record.oldStart), asNumber(record.newStart))
    return index > 0 ? [{ k: 'gap', t: '' }, ...body] : body
  })
  return bounded(lines)
}

/** The first line a patch changes in the new file, for the open button. */
export function firstChangedLine(patch: unknown): number | undefined {
  if (!Array.isArray(patch)) return undefined
  const first = patch[0]
  const start = typeof first === 'object' && first !== null ? asNumber((first as Record<string, unknown>).newStart) : undefined
  return start !== undefined && start > 0 ? start : undefined
}

/** A diff given as text: unified diff with `@@` headers (numbered), or bare `+`/`-` lines (not numbered). */
export function diffFromText(text: string): ChatDiff | null {
  const out: DiffLine[] = []
  let block: string[] = []
  let starts: [number | undefined, number | undefined] = [undefined, undefined]
  const flush = (): void => {
    if (block.length === 0) return
    if (out.length > 0) out.push({ k: 'gap', t: '' })
    out.push(...numbered(block, starts[0], starts[1]))
    block = []
  }
  for (const raw of text.split('\n')) {
    const hunk = HUNK.exec(raw)
    if (hunk) {
      flush()
      starts = [Number(hunk[1]), Number(hunk[2])]
    } else if (/^(?:\+\+\+|---|diff |index |\\ No newline)/.test(raw)) {
      continue
    } else if (raw[0] === '+' || raw[0] === '-' || raw[0] === ' ') {
      block.push(raw)
    }
  }
  flush()
  return bounded(out)
}

export const diffCounts = (diff: ChatDiff): { added: number; removed: number } => ({
  added: diff.lines.filter((line) => line.k === 'add').length,
  removed: diff.lines.filter((line) => line.k === 'del').length
})
