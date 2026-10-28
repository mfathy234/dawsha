import { toProjectPath } from './projectPaths'

export interface ReviewComment {
  id: string
  /** Repo-relative path, as Files lists it. */
  path: string
  line: number
  text: string
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Comments in file and line order, with empty ones dropped. */
export function orderedComments(comments: readonly ReviewComment[]): ReviewComment[] {
  return comments
    .filter((comment) => oneLine(comment.text) !== '')
    .slice()
    .sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1))
}

/** One message for an agent: a `file:line` reference per comment (as the agent sees the path from its folder), then an optional overall note. */
export function buildReviewMessage(comments: readonly ReviewComment[], note = '', prefix = ''): string {
  const ordered = orderedComments(comments)
  if (ordered.length === 0) return ''
  const count = ordered.length
  const lines = [`Review of your changes: ${count} comment${count === 1 ? '' : 's'}.`, '']
  for (const comment of ordered) lines.push(`${toProjectPath(prefix, comment.path)}:${comment.line}  ${oneLine(comment.text)}`)
  const overall = oneLine(note)
  if (overall) lines.push('', `Overall: ${overall}`)
  return lines.join('\n')
}

/** The paths to commit: every changed file except the ones the user unticked. */
export function selectCommitFiles(all: readonly string[], unchecked: ReadonlySet<string>): string[] {
  return all.filter((path) => !unchecked.has(path))
}

const humanise = (slug: string): string => {
  const words = slug.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim()
  return words === '' ? '' : words[0].toUpperCase() + words.slice(1)
}

export interface DraftInput {
  sessionTitle?: string | null
  /** Repo-relative paths being committed. */
  paths: readonly string[]
}

/** A first draft of the commit message: the session's name, else the title of a plan being committed, else a count. The user edits it. */
export function draftCommitMessage(input: DraftInput): string {
  const title = oneLine(input.sessionTitle ?? '')
  if (title !== '' && !/^(session|claude|codex|gemini|shell)(\s+\d+)?$/i.test(title)) return title
  const plan = input.paths.find((path) => /^docs\/plans\/[^/]+\.md$/i.test(path))
  if (plan) return humanise(plan.slice(plan.lastIndexOf('/') + 1))
  if (input.paths.length === 1) return `Update ${input.paths[0].slice(input.paths[0].lastIndexOf('/') + 1)}`
  return input.paths.length === 0 ? '' : `Update ${input.paths.length} files`
}

/** The file N or P moves to in a review; wraps around. Returns the index, or -1 when there is nothing to review. */
export function stepReview(count: number, current: number, direction: 1 | -1): number {
  if (count <= 0) return -1
  if (current < 0) return direction === 1 ? 0 : count - 1
  return (current + direction + count) % count
}
