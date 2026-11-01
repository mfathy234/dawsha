import type { Text } from '@codemirror/state'
import { toRepoPath } from '../../shared/projectPaths'
import type { ProblemSeverity } from '../../shared/problems'

/** What the editor needs to underline one problem from a run. */
export interface ProblemMark {
  severity: ProblemSeverity
  line: number
  column: number | undefined
  message: string
  source: string
}

interface PlacedProblem {
  path: string | null
  line: number
  column?: number
  message: string
  severity: ProblemSeverity
  source: string
  code?: string
}

/** The problems that belong to one open file; `prefix` is the project's place in the repository, since file tabs use repo paths. */
export function marksForFile(problems: readonly PlacedProblem[], prefix: string, filePath: string): ProblemMark[] {
  return problems
    .filter((problem) => problem.path !== null && toRepoPath(prefix, problem.path) === filePath)
    .map((problem) => ({
      severity: problem.severity,
      line: problem.line,
      column: problem.column,
      message: problem.code ? `${problem.message} (${problem.code})` : problem.message,
      source: problem.source
    }))
}

export interface MarkRange {
  from: number
  to: number
}

const WORD = /[\w$]/

/** The span to underline: the word at the reported column, or the rest of the line when no column was printed. Null when the line is gone. */
export function markRange(doc: Text, line: number, column: number | undefined): MarkRange | null {
  if (line < 1 || line > doc.lines) return null
  const info = doc.line(line)
  if (info.length === 0) return { from: info.from, to: info.to }
  if (column === undefined) {
    const lead = info.text.length - info.text.trimStart().length
    return { from: info.from + lead, to: info.to }
  }
  const at = Math.min(Math.max(column - 1, 0), info.length - 1)
  let end = at
  while (end < info.length && WORD.test(info.text[end])) end += 1
  if (end === at) end = at + 1
  return { from: info.from + at, to: info.from + end }
}

export interface OpenTarget {
  path: string
  line: number
  column: number
}

/** Where a Problems row opens: the repo path of the file, its line and the column the tool printed (the start of the line when it printed none). */
export function openTarget(prefix: string, path: string, line: number, column: number | undefined): OpenTarget {
  return { path: toRepoPath(prefix, path), line, column: column !== undefined && column >= 1 ? column : 1 }
}
