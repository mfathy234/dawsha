export type PrUnavailable = 'gh-missing' | 'signed-out' | 'no-remote' | 'not-repo' | 'detached'

export interface PrInfo {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  base: string
  head: string
  headSha: string
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision: string
}

export interface PrCheck {
  name: string
  workflow: string
  bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'
  link: string
}

export interface PrComment {
  id: number
  author: string
  body: string
  /** Null for a review summary that is not on a line. */
  path: string | null
  line: number | null
  url: string
  outdated: boolean
}

export type MergeMethod = 'squash' | 'merge' | 'rebase'

export type PrOverviewResult =
  | { ok: true; branch: string; remote: string; pr: PrInfo | null; checks: PrCheck[]; comments: PrComment[]; note?: string }
  | { ok: false; reason: PrUnavailable; message: string }
  | { ok: false; reason: 'failed'; message: string }

export type PrActionResult = { ok: true; message: string; url?: string } | { ok: false; error: string }

export type PrRequest =
  | { folder: string; action: 'overview' }
  | { folder: string; action: 'create'; title: string; body: string; base: string; draft: boolean }
  | { folder: string; action: 'merge'; number: number; headSha: string; method: MergeMethod }

export const PR_UNAVAILABLE_TEXT: Record<PrUnavailable, string> = {
  'gh-missing': 'The GitHub CLI (gh) is not installed. Install it from cli.github.com, then reopen this tab.',
  'signed-out': 'The GitHub CLI is signed out. Run "gh auth login" in a terminal, then reopen this tab.',
  'no-remote': 'This repository has no remote, so there is nowhere to open a pull request. Add one with "git remote add origin <url>".',
  'not-repo': 'This folder is not a git repository.',
  detached: 'HEAD is detached. Switch to a branch to open or follow a pull request.'
}

const MAX_TITLE = 256
const MAX_BODY = 20_000
const MAX_BASE = 200
const METHODS: readonly MergeMethod[] = ['squash', 'merge', 'rebase']
const CONTROL = /[\u0000-\u001f\u007f]/
const BASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const SHA = /^[0-9a-f]{40}$/i

export function titleProblem(title: unknown): string | null {
  if (typeof title !== 'string' || title.trim() === '') return 'Give the pull request a title.'
  if (title.length > MAX_TITLE) return `Keep the title under ${MAX_TITLE} characters.`
  return CONTROL.test(title) ? 'The title cannot contain line breaks or control characters.' : null
}

export function bodyProblem(body: unknown): string | null {
  if (typeof body !== 'string') return 'The description is not text.'
  if (body.length > MAX_BODY) return `Keep the description under ${MAX_BODY} characters.`
  return body.includes('\0') ? 'The description cannot contain null characters.' : null
}

export function baseProblem(base: unknown): string | null {
  if (typeof base !== 'string' || base === '') return null
  if (base.length > MAX_BASE || !BASE_NAME.test(base) || base.includes('..') || base.endsWith('/') || base.endsWith('.lock')) return 'That is not a valid branch name.'
  return null
}

export const isMergeMethod = (method: unknown): method is MergeMethod => typeof method === 'string' && (METHODS as readonly string[]).includes(method)
export const isPrNumber = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 1e9
export const isCommitSha = (value: unknown): value is string => typeof value === 'string' && SHA.test(value)

/** Why a request is refused before gh runs, or null when it is well formed. */
export function requestProblem(request: PrRequest): string | null {
  if (request.action === 'create') return titleProblem(request.title) ?? bodyProblem(request.body) ?? baseProblem(request.base)
  if (request.action === 'merge') {
    if (!isPrNumber(request.number)) return 'That is not a pull request number.'
    if (!isCommitSha(request.headSha)) return 'The pull request has not been read yet.'
    return isMergeMethod(request.method) ? null : 'Choose how to merge.'
  }
  return null
}

/** What a failed gh call means for the tab, from its message. Null when it is some other failure. */
export function classifyGhFailure(message: string): PrUnavailable | 'no-pr' | null {
  if (/no pull requests found|could not find any pull requests/i.test(message)) return 'no-pr'
  if (/gh auth login|not logged in|no oauth token|authentication required|bad credentials|http 401/i.test(message)) return 'signed-out'
  if (/not a git repository/i.test(message)) return 'not-repo'
  if (/none of the git remotes|no git remotes|no remote/i.test(message)) return 'no-remote'
  return null
}

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {})

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function parsePrInfo(raw: string): PrInfo | null {
  const data = record(parseJson(raw))
  if (!isPrNumber(data.number)) return null
  const state = text(data.state)
  const mergeable = text(data.mergeable)
  return {
    number: data.number,
    title: text(data.title),
    url: text(data.url),
    state: state === 'MERGED' || state === 'CLOSED' ? state : 'OPEN',
    isDraft: data.isDraft === true,
    base: text(data.baseRefName),
    head: text(data.headRefName),
    headSha: text(data.headRefOid),
    mergeable: mergeable === 'MERGEABLE' || mergeable === 'CONFLICTING' ? mergeable : 'UNKNOWN',
    reviewDecision: text(data.reviewDecision)
  }
}

const BUCKETS = new Set(['pass', 'fail', 'pending', 'skipping', 'cancel'])

export function parseChecks(raw: string): PrCheck[] {
  const data = parseJson(raw)
  if (!Array.isArray(data)) return []
  return data.map(record).filter((item) => text(item.name) !== '').map((item) => ({
    name: text(item.name),
    workflow: text(item.workflow),
    bucket: BUCKETS.has(text(item.bucket)) ? (text(item.bucket) as PrCheck['bucket']) : 'pending',
    link: text(item.link)
  }))
}

export function parseReviewComments(raw: string): PrComment[] {
  const data = parseJson(raw)
  if (!Array.isArray(data)) return []
  return data.map(record).filter((item) => typeof item.id === 'number' && text(item.body) !== '').map((item) => {
    const line = typeof item.line === 'number' ? item.line : typeof item.original_line === 'number' ? item.original_line : null
    return {
      id: item.id as number,
      author: text(record(item.user).login, 'someone'),
      body: text(item.body),
      path: text(item.path) || null,
      line,
      url: text(item.html_url),
      outdated: item.line === null || item.line === undefined
    }
  })
}

/** Review summaries that ask for changes carry feedback that is not on a line. */
export function parseReviewSummaries(raw: string): PrComment[] {
  const data = record(parseJson(raw))
  const reviews = Array.isArray(data.reviews) ? data.reviews.map(record) : []
  return reviews.filter((review) => text(review.body).trim() !== '').map((review, index) => ({
    id: -(index + 1),
    author: text(record(review.author).login, 'someone'),
    body: text(review.body),
    path: null,
    line: null,
    url: '',
    outdated: false
  }))
}

export const failedChecks = (checks: readonly PrCheck[]): PrCheck[] => checks.filter((check) => check.bucket === 'fail')

const FEEDBACK_MAX = 40
const BODY_MAX = 600

const oneLine = (value: string, max = BODY_MAX): string => {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}...` : flat
}

export function commentLine(comment: PrComment): string {
  const place = comment.path ? `@${comment.path}${comment.line ? `#L${comment.line}` : ''} ` : ''
  return `${place}${comment.author}: ${oneLine(comment.body)}${comment.outdated && comment.path ? ' (on an older version of the code)' : ''}`
}

export function checkLine(check: PrCheck): string {
  const name = check.workflow ? `${check.workflow} / ${check.name}` : check.name
  return check.link ? `${name} (${check.link})` : name
}

/** The prompt text for an agent: what reviewers asked for and what CI rejected. Text only, nothing from the config files. */
export function feedbackMessage(pr: Pick<PrInfo, 'number' | 'title'>, comments: readonly PrComment[], failures: readonly PrCheck[]): string {
  const parts: string[] = [`Address the feedback on pull request #${pr.number} (${oneLine(pr.title, 120)}).`]
  if (comments.length > 0) {
    const shown = comments.slice(0, FEEDBACK_MAX)
    parts.push(`Review comments:\n${shown.map((comment) => `- ${commentLine(comment)}`).join('\n')}${comments.length > shown.length ? `\n(and ${comments.length - shown.length} more)` : ''}`)
  }
  if (failures.length > 0) parts.push(`CI failures:\n${failures.slice(0, FEEDBACK_MAX).map((check) => `- ${checkLine(check)}`).join('\n')}`)
  return `${parts.join('\n\n')} `
}

export function mergeCopy(pr: Pick<PrInfo, 'number' | 'title' | 'base'>, method: MergeMethod): { title: string; body: string; confirmLabel: string } {
  const how = method === 'squash' ? 'squash and merge' : method === 'rebase' ? 'rebase and merge' : 'merge'
  const name = `#${pr.number} ${oneLine(pr.title, 80)}`
  return {
    title: 'Merge this pull request?',
    body: `This will ${how} ${name} into ${pr.base}. Merging cannot be undone from Dawsha.`,
    confirmLabel: `Merge ${name}`
  }
}

export const MERGE_LABEL: Record<MergeMethod, string> = { squash: 'Squash and merge', merge: 'Create a merge commit', rebase: 'Rebase and merge' }
