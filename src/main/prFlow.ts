import {
  PR_UNAVAILABLE_TEXT,
  classifyGhFailure,
  parseChecks,
  parsePrInfo,
  parseReviewComments,
  parseReviewSummaries,
  requestProblem,
  type PrActionResult,
  type PrComment,
  type PrOverviewResult,
  type PrRequest,
  type PrUnavailable
} from '../shared/prFlow'
import { git, repoRoot } from './gitCommit'
import { runGh, type GhRun } from './ghRunner'

const PR_FIELDS = 'number,title,url,state,isDraft,baseRefName,headRefName,headRefOid,mergeable,reviewDecision,reviews'
const MERGE_MS = 90_000
const tail = (text: string): string => text.split('\n').filter(Boolean).slice(-4).join('\n').slice(0, 600)

const unavailable = (reason: PrUnavailable): PrOverviewResult => ({ ok: false, reason, message: PR_UNAVAILABLE_TEXT[reason] })
const failed = (message: string): PrOverviewResult => ({ ok: false, reason: 'failed', message: tail(message) || 'gh failed without a message.' })

interface Repo {
  root: string
  branch: string
  remote: string
}

async function inspectRepo(folder: string): Promise<Repo | PrOverviewResult> {
  const root = await repoRoot(folder)
  if (!root) return unavailable('not-repo')
  const [branch, remotes] = await Promise.all([git(root, ['rev-parse', '--abbrev-ref', 'HEAD']), git(root, ['remote'])])
  const name = branch.stdout.trim()
  if (!branch.ok || name === '' || name === 'HEAD') return unavailable('detached')
  const remote = remotes.stdout.split('\n').map((line) => line.trim()).find(Boolean)
  return remote ? { root, branch: name, remote } : unavailable('no-remote')
}

const isRepo = (value: Repo | PrOverviewResult): value is Repo => 'root' in value

/** gh is installed and signed in, or the state to show instead. */
async function signedIn(root: string): Promise<PrOverviewResult | null> {
  const auth = await runGh(root, ['auth', 'status'])
  if (auth.missing) return unavailable('gh-missing')
  return auth.ok ? null : unavailable(classifyGhFailure(auth.message) === 'no-remote' ? 'no-remote' : 'signed-out')
}

async function reviewFeedback(root: string, number: number, summaries: PrComment[]): Promise<PrComment[]> {
  const comments = await runGh(root, ['api', `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`])
  return [...summaries, ...(comments.ok ? parseReviewComments(comments.stdout) : [])]
}

async function checksFor(root: string, number: number): Promise<GhRun> {
  return runGh(root, ['pr', 'checks', String(number), '--json', 'name,workflow,bucket,link'])
}

export async function prOverview(folder: string): Promise<PrOverviewResult> {
  const repo = await inspectRepo(folder)
  if (!isRepo(repo)) return repo
  const blocked = await signedIn(repo.root)
  if (blocked) return blocked
  const view = await runGh(repo.root, ['pr', 'view', '--json', PR_FIELDS])
  const problem = view.ok ? null : classifyGhFailure(view.message)
  if (problem === 'no-pr') return { ok: true, branch: repo.branch, remote: repo.remote, pr: null, checks: [], comments: [] }
  if (problem === 'signed-out' || problem === 'no-remote') return unavailable(problem)
  const pr = view.ok ? parsePrInfo(view.stdout) : null
  if (!pr) return failed(view.message)
  // gh exits non-zero while checks fail or are pending but still prints the list, so the output decides.
  const [checks, comments] = await Promise.all([checksFor(repo.root, pr.number), reviewFeedback(repo.root, pr.number, parseReviewSummaries(view.stdout))])
  return { ok: true, branch: repo.branch, remote: repo.remote, pr, checks: parseChecks(checks.stdout), comments }
}

function createArgs(request: Extract<PrRequest, { action: 'create' }>): string[] {
  return ['pr', 'create', `--title=${request.title.trim()}`, `--body=${request.body}`, ...(request.base ? [`--base=${request.base}`] : []), ...(request.draft ? ['--draft'] : [])]
}

async function createPr(root: string, request: Extract<PrRequest, { action: 'create' }>): Promise<PrActionResult> {
  const run = await runGh(root, createArgs(request), MERGE_MS)
  if (!run.ok) return { ok: false, error: tail(run.message) || 'gh could not open the pull request.' }
  const url = run.stdout.split('\n').map((line) => line.trim()).find((line) => /^https:\/\//.test(line))
  return { ok: true, message: 'Pull request opened.', ...(url ? { url } : {}) }
}

async function mergePr(root: string, request: Extract<PrRequest, { action: 'merge' }>): Promise<PrActionResult> {
  const current = await runGh(root, ['pr', 'view', '--json', PR_FIELDS])
  const pr = current.ok ? parsePrInfo(current.stdout) : null
  if (!pr || pr.number !== request.number) return { ok: false, error: 'The pull request for this branch is not the one you confirmed. Reload the tab.' }
  if (pr.state !== 'OPEN') return { ok: false, error: `Pull request #${pr.number} is already ${pr.state.toLowerCase()}.` }
  if (pr.headSha.toLowerCase() !== request.headSha.toLowerCase()) return { ok: false, error: 'The branch changed since you opened this tab. Reload it and confirm again.' }
  const run = await runGh(root, ['pr', 'merge', String(request.number), `--${request.method}`, `--match-head-commit=${request.headSha}`], MERGE_MS)
  return run.ok ? { ok: true, message: `Merged #${request.number}.` } : { ok: false, error: tail(run.message) || 'gh could not merge the pull request.' }
}

/** Pull request actions through gh. The folder must already be a known project. */
export async function runPrFlow(request: PrRequest): Promise<PrOverviewResult | PrActionResult> {
  const problem = requestProblem(request)
  if (problem) return request.action === 'overview' ? failed(problem) : { ok: false, error: problem }
  if (request.action === 'overview') return prOverview(request.folder)
  const repo = await inspectRepo(request.folder)
  if (!isRepo(repo)) return { ok: false, error: repo.ok ? 'Not a repository.' : repo.message }
  const blocked = await signedIn(repo.root)
  if (blocked) return { ok: false, error: blocked.ok ? '' : blocked.message }
  return request.action === 'create' ? createPr(repo.root, request) : mergePr(repo.root, request)
}
