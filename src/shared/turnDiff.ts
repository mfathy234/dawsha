/** A file's diff for one reply, as rows ready to draw: hunk headers, then lines with their old and new numbers. */
export type TurnRowKind = 'hunk' | 'add' | 'del' | 'ctx'

export interface TurnDiffRow {
  k: TurnRowKind
  /** Line number in the file before the reply. */
  old?: number
  /** Line number in the file now. */
  new?: number
  t: string
}

export interface TurnDiff {
  rows: TurnDiffRow[]
  hunks: number
  added: number
  removed: number
}

/** A diff longer than this many rows shows only its first rows until it is opened. */
export const TURN_DIFF_FOLD = 40
export const TURN_DIFF_MAX_ROWS = 2000
const LINE_CHARS = 300
/** A file saved this long after the reply was written still counts as part of the reply. */
export const EDIT_SLACK_MS = 3000

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/

const cut = (text: string): string => (text.length > LINE_CHARS ? `${text.slice(0, LINE_CHARS)}…` : text)

/** Unified diff text to rows. Headers before the first hunk are dropped; the text after `@@ … @@` names the hunk. */
export function parseTurnDiff(text: string): TurnDiff {
  const rows: TurnDiffRow[] = []
  let oldNo = 0
  let newNo = 0
  let hunks = 0
  let inside = false
  for (const raw of text.split('\n')) {
    const hunk = HUNK.exec(raw)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      hunks += 1
      inside = true
      const label = hunk[3]?.trim() ?? ''
      rows.push({ k: 'hunk', t: label ? `@@ ${cut(label)} @@` : `@@ -${hunk[1]} +${hunk[2]} @@` })
      continue
    }
    if (!inside || raw.startsWith('\\')) continue
    const mark = raw[0]
    if (mark === '+') rows.push({ k: 'add', new: newNo++, t: cut(raw.slice(1)) })
    else if (mark === '-') rows.push({ k: 'del', old: oldNo++, t: cut(raw.slice(1)) })
    else if (mark === ' ') rows.push({ k: 'ctx', old: oldNo++, new: newNo++, t: cut(raw.slice(1)) })
  }
  const kept = rows.slice(0, TURN_DIFF_MAX_ROWS)
  return {
    rows: kept,
    hunks,
    added: kept.filter((row) => row.k === 'add').length,
    removed: kept.filter((row) => row.k === 'del').length
  }
}

/** How many rows to draw: the first 40 of a long diff until it is opened. */
export function visibleRows(diff: TurnDiff, open: boolean): TurnDiffRow[] {
  return open || diff.rows.length <= TURN_DIFF_FOLD ? diff.rows : diff.rows.slice(0, TURN_DIFF_FOLD)
}

export const isFolded = (diff: TurnDiff, open: boolean): boolean => !open && diff.rows.length > TURN_DIFF_FOLD

/** The footer text: how many of the file's changes (hunks) are on screen. */
export function changesLabel(diff: TurnDiff, open: boolean): string {
  const seen = visibleRows(diff, open).filter((row) => row.k === 'hunk').length
  return `${seen} of ${diff.hunks} ${diff.hunks === 1 ? 'change' : 'changes'}`
}

/** True when the file was saved after the reply finished, so what is on disk is more than the reply wrote. */
export function editedSince(mtimeMs: number | null | undefined, repliedAt: number | undefined): boolean {
  if (typeof mtimeMs !== 'number' || typeof repliedAt !== 'number') return false
  return mtimeMs > repliedAt + EDIT_SLACK_MS
}
