import { findFilePaths, type FileMatch, type FileRef } from './filePaths'

export type LinkSegment = { kind: 'text'; text: string } | { kind: 'file'; text: string; ref: FileRef }

/** Cuts text into plain runs and file references; only the matches `keep` accepts become references. */
export function splitByMatches(text: string, matches: readonly FileMatch[], keep: (match: FileMatch) => boolean): LinkSegment[] {
  const out: LinkSegment[] = []
  let at = 0
  for (const match of matches) {
    if (match.start < at || !keep(match)) continue
    if (match.start > at) out.push({ kind: 'text', text: text.slice(at, match.start) })
    const ref: FileRef = { path: match.path }
    if (match.line !== undefined) ref.line = match.line
    if (match.col !== undefined) ref.col = match.col
    out.push({ kind: 'file', text: text.slice(match.start, match.end), ref })
    at = match.end
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out
}

/** The one path an inline code span is made of, or null when it holds anything else. */
export function wholePath(code: string): FileMatch | null {
  const trimmed = code.trim()
  const [only, ...rest] = findFilePaths(trimmed)
  return only && rest.length === 0 && only.start === 0 && only.end === trimmed.length ? only : null
}

export const candidatePaths = (matches: readonly FileMatch[]): string[] => [...new Set(matches.map((match) => match.path))]
