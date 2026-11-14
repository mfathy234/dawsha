/** Dawsha 1.9.0: watching the pull request a session opened. Pure shaping and decisions; gh runs in the main process. */

export type PrPhase = 'running' | 'failed' | 'ready' | 'waiting' | 'conflicts' | 'draft' | 'merged' | 'closed' | 'link'

export interface PrWatchCheck {
  name: string
  workflow: string
  bucket: 'pass' | 'fail' | 'pending' | 'skipping'
  link: string
  /** The GitHub Actions run id, when the check belongs to one. */
  runId: string
}

export interface PrWatchState {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  headSha: string
  headRef: string
  baseRef: string
  mergeState: string
  reviewDecision: string
  phase: PrPhase
  /** The checks that failed, at most FAILED_MAX. */
  failed: PrWatchCheck[]
  failedCount: number
  pending: number
  passed: number
}

/** What the renderer is told for one session: a state, or nothing when no pull request is known. */
export interface PrWatchUpdate {
  key: string
  state: PrWatchState | null
}

export interface PrWatchTarget {
  key: string
  folder: string
  /** A pull request number already known for this session; absent while Dawsha is still looking. */
  number: number | null
}

export interface PrFixLog {
  check: string
  log: string
}

export type PrFixResult = { ok: true; message: string } | { ok: false; error: string }

export type PrMergeResult = { ok: true; message: string } | { ok: false; error: string }

export interface PrTidyRequest {
  repo: string
  path: string
  branch: string
  headSha: string
  /** Only accept a checkout whose commits are all on the pull request. */
  strict: boolean
  /** Check and refuse, but remove nothing. */
  dryRun: boolean
}

export type PrTidyResult = { ok: true } | { ok: false; error: string }

export const PR_WATCH_IPC = {
  sync: 'prwatch:sync',
  refresh: 'prwatch:refresh',
  fixCi: 'prwatch:fix-ci',
  merge: 'prwatch:merge',
  tidy: 'prwatch:tidy',
  update: 'prwatch:update'
} as const

export interface PrWatchApi {
  sync(targets: PrWatchTarget[]): void
  refresh(key: string): void
  fixCi(folder: string, state: Pick<PrWatchState, 'number' | 'failed'>): Promise<PrFixResult>
  merge(request: { folder: string; number: number; headSha: string; command: string }): Promise<PrMergeResult>
  tidy(request: PrTidyRequest): Promise<PrTidyResult>
  onUpdate(listener: (update: PrWatchUpdate) => void): () => void
}

export const PR_FIELDS = 'state,mergeStateStatus,statusCheckRollup,reviewDecision,url,number,title,isDraft,headRefOid,headRefName,baseRefName'
export const DEFAULT_MERGE_COMMAND = 'gh pr merge <n> --squash'
export const FAILED_MAX = 12
export const POLL_VISIBLE_MS = 60_000
export const POLL_HIDDEN_MS = 300_000
export const DISCOVER_MS = 300_000
export const BACKOFF_MAX_MS = 600_000
export const DEFAULT_BRANCHES: readonly string[] = ['main', 'master', 'develop', 'trunk', 'HEAD']

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {})

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 1e9

function runIdOf(url: string): string {
  const match = /\/actions\/runs\/(\d+)/.exec(url)
  return match ? match[1] : ''
}

function bucketOf(item: Record<string, unknown>): PrWatchCheck['bucket'] {
  if (item.__typename === 'StatusContext' || (typeof item.context === 'string' && item.status === undefined)) {
    const state = text(item.state).toUpperCase()
    if (state === 'SUCCESS') return 'pass'
    return state === 'FAILURE' || state === 'ERROR' ? 'fail' : 'pending'
  }
  if (text(item.status).toUpperCase() !== 'COMPLETED') return 'pending'
  const conclusion = text(item.conclusion).toUpperCase()
  if (conclusion === 'SUCCESS') return 'pass'
  if (conclusion === 'SKIPPED' || conclusion === 'NEUTRAL') return 'skipping'
  return 'fail'
}

export function parseRollup(value: unknown): PrWatchCheck[] {
  if (!Array.isArray(value)) return []
  return value.map(record).map((item) => {
    const link = text(item.detailsUrl) || text(item.targetUrl)
    return { name: text(item.name) || text(item.context), workflow: text(item.workflowName), bucket: bucketOf(item), link, runId: runIdOf(link) }
  }).filter((check) => check.name !== '')
}

export function prPhase(input: { state: string; isDraft: boolean; mergeState: string; failedCount: number; pending: number }): PrPhase {
  if (input.state === 'MERGED') return 'merged'
  if (input.state === 'CLOSED') return 'closed'
  if (input.failedCount > 0) return 'failed'
  if (input.pending > 0) return 'running'
  if (input.isDraft || input.mergeState === 'DRAFT') return 'draft'
  if (input.mergeState === 'DIRTY') return 'conflicts'
  return input.mergeState === 'CLEAN' || input.mergeState === 'HAS_HOOKS' ? 'ready' : 'waiting'
}

/** The state of a pull request from `gh pr view --json` output, or null when it is not a pull request. */
export function parseWatchedPr(raw: string): PrWatchState | null {
  const data = record(parseJson(raw))
  if (!isNumber(data.number)) return null
  const rawState = text(data.state).toUpperCase()
  const state = rawState === 'MERGED' || rawState === 'CLOSED' ? rawState : 'OPEN'
  const checks = parseRollup(data.statusCheckRollup)
  const failed = checks.filter((check) => check.bucket === 'fail')
  const pending = checks.filter((check) => check.bucket === 'pending').length
  const isDraft = data.isDraft === true
  const mergeState = text(data.mergeStateStatus).toUpperCase()
  return {
    number: data.number,
    title: text(data.title),
    url: text(data.url),
    state,
    isDraft,
    headSha: text(data.headRefOid),
    headRef: text(data.headRefName),
    baseRef: text(data.baseRefName),
    mergeState,
    reviewDecision: text(data.reviewDecision).toUpperCase(),
    phase: prPhase({ state, isDraft, mergeState, failedCount: failed.length, pending }),
    failed: failed.slice(0, FAILED_MAX),
    failedCount: failed.length,
    pending,
    passed: checks.length - failed.length - pending
  }
}

/** "PR #34: checks running", as the session's status line shows it. */
export function prLine(state: PrWatchState): string {
  const head = `PR #${state.number}`
  switch (state.phase) {
    case 'running': return `${head}: checks running`
    case 'failed': return `${head}: checks failed (${state.failedCount})`
    case 'ready': return `${head}: ready to merge`
    case 'merged': return `${head}: merged`
    case 'closed': return `${head}: closed`
    case 'draft': return `${head}: draft`
    case 'conflicts': return `${head}: has conflicts`
    case 'link': return head
    default: return state.reviewDecision === 'CHANGES_REQUESTED' ? `${head}: changes requested` : state.mergeState === 'BEHIND' ? `${head}: behind the base branch` : `${head}: waiting for review`
  }
}

/** The quiet note under a PR link whose host Dawsha cannot read. */
export const PR_LINK_ONLY_NOTE = 'Status is only read for GitHub pull requests.'

/** A pull request that Dawsha can open but not read, for example on Azure DevOps. */
export function linkOnlyPr(number: number, url: string): PrWatchState {
  return { number, title: '', url, state: 'OPEN', isDraft: false, headSha: '', headRef: '', baseRef: '', mergeState: '', reviewDecision: '', phase: 'link', failed: [], failedCount: 0, pending: 0, passed: 0 }
}

const PR_URL = /https:\/\/[^\s"'<>)\]]+?\/(?:pull|pullrequest|pull-requests)\/(\d+)/g

/** The newest pull request URL in some terminal text, for an agent that ran `gh pr create`. */
export function findPrUrl(output: string): { number: number; url: string } | null {
  let found: { number: number; url: string } | null = null
  for (const match of output.matchAll(PR_URL)) {
    const number = Number(match[1])
    if (isNumber(number)) found = { number, url: match[0] }
  }
  return found
}

export const isSupportedHost = (url: string): boolean => /^https:\/\/(?:[\w-]+\.)*github\.com\//i.test(url) || /\/pull\/\d+/.test(url)

export function pollDelayMs(input: { visible: boolean; failures: number }): number {
  const base = input.visible ? POLL_VISIBLE_MS : POLL_HIDDEN_MS
  return Math.min(BACKOFF_MAX_MS, base * 2 ** Math.min(Math.max(0, input.failures), 4))
}

export interface WatchSchedule {
  /** Next time (ms) this entry may be polled. */
  nextAt: number
  inFlight: boolean
  done: boolean
}

export const isDue = (entry: WatchSchedule, now: number): boolean => !entry.done && !entry.inFlight && now >= entry.nextAt

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g
const STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s?/g
const SIGNAL = /error|fail|✗|✖|×|exception|assert|panic|cannot|undefined|not found|expected|##\[error\]/i
const LOG_LINES = 40
const LOG_CHARS = 2500

/** The lines of a failed run's log that matter: error lines with a little context, without colours or timestamps, capped in size. */
export function trimFailedLog(raw: string, maxLines = LOG_LINES, maxChars = LOG_CHARS): string {
  const lines = raw.replace(ANSI, '').replace(/\r/g, '').split('\n').map((line) => {
    const parts = line.split('\t')
    const body = parts.length >= 3 ? parts.slice(2).join(' ') : line
    return body.replace(STAMP, '').trimEnd()
  }).filter((line) => line.trim() !== '')
  if (lines.length === 0) return ''
  const keep = new Set<number>()
  lines.forEach((line, index) => {
    if (!SIGNAL.test(line)) return
    for (let at = Math.max(0, index - 2); at <= Math.min(lines.length - 1, index + 2); at += 1) keep.add(at)
  })
  const picked = keep.size > 0 ? [...keep].sort((a, b) => a - b) : lines.map((_, index) => index)
  const chosen = picked.slice(-maxLines).map((index) => lines[index])
  const joined = chosen.join('\n')
  return joined.length > maxChars ? `...${joined.slice(joined.length - maxChars)}` : joined
}

/** The message sent to the agent when CI failed: the PR, each failed check and its trimmed log. */
export function fixCiMessage(number: number, logs: readonly PrFixLog[]): string {
  const body = logs.map((entry) => (entry.log === '' ? `${entry.check}: no log was available.` : `${entry.check}: ${entry.log}`)).join('\n\n')
  return `CI failed on PR #${number}: ${body}\n\nFix it and push.`
}

export interface AutoFixInput {
  enabled: boolean
  state: Pick<PrWatchState, 'phase' | 'headSha' | 'pending' | 'failedCount'>
  /** The commit Fix CI was last sent for, so one commit is never fixed twice. */
  lastFixedSha: string | null
}

/** Fix CI automatically once per failing commit, after the other checks have finished. */
export function shouldAutoFix(input: AutoFixInput): boolean {
  const { state } = input
  return input.enabled && state.phase === 'failed' && state.pending === 0 && state.failedCount > 0 && state.headSha !== '' && state.headSha !== input.lastFixedSha
}

export type MergeCommand = { ok: true; args: string[]; admin: boolean } | { ok: false; error: string }

const MERGE_TOKEN = /^[A-Za-z0-9._:=@/-]+$/

/** The arguments for gh from a project's merge command. No shell runs it, so only plain flags are accepted. */
export function parseMergeCommand(template: string, number: number, headSha: string): MergeCommand {
  const tokens = (template.trim() === '' ? DEFAULT_MERGE_COMMAND : template).trim().split(/\s+/)
  if (tokens[0] !== 'gh' || tokens[1] !== 'pr' || tokens[2] !== 'merge') return { ok: false, error: 'The merge command must start with "gh pr merge".' }
  if (!isNumber(number)) return { ok: false, error: 'That is not a pull request number.' }
  const rest = tokens.slice(3)
  const flags = rest.filter((token) => token !== '<n>' && token !== '{n}')
  if (flags.some((token) => !MERGE_TOKEN.test(token))) return { ok: false, error: 'Use only plain flags in the merge command, like --squash or --admin.' }
  if (flags.some((token) => /^(?:--repo|-R)\b/.test(token))) return { ok: false, error: 'Leave out --repo: Dawsha merges the pull request of this session.' }
  const numbered = flags.filter((token) => /^\d+$/.test(token))
  if (numbered.length > 0 && numbered.some((token) => token !== String(number))) return { ok: false, error: 'The merge command names a different pull request.' }
  const others = flags.filter((token) => !/^\d+$/.test(token))
  const hasHead = others.some((token) => token.startsWith('--match-head-commit'))
  const head = /^[0-9a-f]{40}$/i.test(headSha) && !hasHead ? [`--match-head-commit=${headSha}`] : []
  const args = ['pr', 'merge', String(number), ...others, ...head]
  return { ok: true, args, admin: others.includes('--admin') }
}

export interface MergeInput {
  enabled: boolean
  state: Pick<PrWatchState, 'phase' | 'state' | 'headSha'>
  admin: boolean
  /** The commit a merge was last tried for, so a refused merge is not retried on every poll. */
  lastTriedSha: string | null
}

/** Merge when green: every check passed and GitHub calls it mergeable. A blocked review only counts when the command says --admin. */
export function shouldMerge(input: MergeInput): boolean {
  const { state } = input
  if (!input.enabled || state.state !== 'OPEN' || state.headSha === '' || state.headSha === input.lastTriedSha) return false
  return state.phase === 'ready' || (state.phase === 'waiting' && input.admin)
}

export interface TidyInput {
  enabled: boolean
  state: Pick<PrWatchState, 'phase'>
}

/** Tidy up after a merge or close, when the project asked for it. */
export function shouldTidy(input: TidyInput): boolean {
  return input.enabled && (input.state.phase === 'merged' || input.state.phase === 'closed')
}

/** A pull request not seen open in this run (found already merged) only counts when the checkout is exactly on its last commit. */
export const tidyIsStrict = (seenOpen: boolean): boolean => !seenOpen

export const tidyNote = (state: Pick<PrWatchState, 'phase' | 'number'>): string => `${state.phase === 'merged' ? 'Merged as' : 'Closed with'} PR #${state.number}`

export interface PrNotice {
  title: string
  body: string
}

/** A notification when the phase moves to one worth telling, else null. */
export function prNotice(before: PrPhase | null, state: PrWatchState): PrNotice | null {
  if (before === state.phase) return null
  const name = state.title ? `#${state.number} ${state.title}` : `#${state.number}`
  if (state.phase === 'failed') return { title: `Checks failed on PR #${state.number}`, body: `${state.failedCount} failing: ${state.failed.slice(0, 3).map((check) => check.name).join(', ')}` }
  if (state.phase === 'ready') return { title: `PR #${state.number} is ready to merge`, body: name }
  if (state.phase === 'merged') return { title: `PR #${state.number} was merged`, body: name }
  return null
}

export const DEFAULT_BRANCH_SET: ReadonlySet<string> = new Set(DEFAULT_BRANCHES)

/** Branches that are never a session's own pull request, so they are not looked up. */
export const worthLooking = (branch: string | null): boolean => !!branch && !DEFAULT_BRANCH_SET.has(branch)

export function isPrWatchTarget(value: unknown): value is PrWatchTarget {
  const item = record(value)
  return typeof item.key === 'string' && item.key !== '' && item.key.length < 200 && typeof item.folder === 'string' && item.folder !== '' && !item.folder.includes('\0') && (item.number === null || isNumber(item.number))
}
