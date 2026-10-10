import {
  BRANCH_REF_FORMAT,
  STASH_LIST_FORMAT,
  branchNameProblem,
  describeSync,
  isDirtyRefusal,
  isDivergedPull,
  parseBranchRefs,
  parseStashList,
  pullSummary,
  stashMessage,
  trimGitMessage,
  type BranchListResult,
  type GitQuickRequest,
  type GitQuickResult,
  type SwitchMode
} from '../shared/gitBranches'
import { forgetChanges, gitSync } from './git'
import { REPO_BUSY, git, repoRoot, tryLockRepo, unlockRepo } from './gitCommit'

const QUICK_MS = 15_000
const SLOW_MS = 180_000
const NOT_A_REPO = 'This folder is not a git repository.'


function fail(error: string, canStash?: boolean): GitQuickResult {
  const text = trimGitMessage(error) || 'Git failed without a message.'
  return canStash ? { ok: false, error: text, canStash } : { ok: false, error: text }
}

function done(message: string): GitQuickResult {
  return { ok: true, message }
}

export async function listBranches(folder: unknown): Promise<BranchListResult> {
  const root = await repoRoot(folder)
  if (!root) return { ok: false, error: NOT_A_REPO }
  const refs = await git(root, ['for-each-ref', `--format=${BRANCH_REF_FORMAT}`, 'refs/heads', 'refs/remotes'])
  return refs.ok ? { ok: true, branches: parseBranchRefs(refs.stdout) } : { ok: false, error: trimGitMessage(refs.message) }
}

async function validBranchName(root: string, name: unknown): Promise<string | null> {
  if (typeof name !== 'string' || branchNameProblem(name) !== null) return null
  return (await git(root, ['check-ref-format', '--branch', name])).ok ? name : null
}

async function refExists(root: string, ref: string): Promise<boolean> {
  return (await git(root, ['show-ref', '--verify', '--quiet', ref])).ok
}

async function pull(root: string): Promise<GitQuickResult> {
  const pulled = await git(root, ['pull', '--ff-only'], SLOW_MS)
  if (pulled.ok) return done(pullSummary(pulled.stdout))
  if (isDivergedPull(pulled.message)) {
    return fail(`${trimGitMessage(pulled.message)}\nThe branches have diverged. Resolve this from the Changes panel or your terminal; Dawsha never merges or rebases for you.`)
  }
  return fail(pulled.message)
}

async function fetch(root: string): Promise<GitQuickResult> {
  const fetched = await git(root, ['fetch', '--prune'], SLOW_MS)
  if (!fetched.ok) return fail(fetched.message)
  forgetChanges()
  const sync = await gitSync(root)
  return done(sync ? `Fetched. ${describeSync(sync)}.` : 'Fetched. This branch has no upstream.')
}

async function stash(root: string): Promise<GitQuickResult> {
  const pushed = await git(root, ['stash', 'push', '-u', '-m', stashMessage(new Date())], QUICK_MS, false)
  if (!pushed.ok) return fail(pushed.message)
  return done(/no local changes/i.test(pushed.message) ? 'Nothing to stash.' : 'Changes stashed. Use "Apply last stash" to bring them back.')
}

async function stashPop(root: string): Promise<GitQuickResult> {
  const list = await git(root, ['stash', 'list', `--format=${STASH_LIST_FORMAT}`])
  const last = parseStashList(list.stdout)[0]
  if (!last) return fail('There is no stash to apply.')
  const popped = await git(root, ['stash', 'pop'], QUICK_MS, false)
  if (popped.ok) return done(`Applied stash: ${last.subject}`)
  return fail(`${trimGitMessage(popped.message)}\nThe stash was kept so nothing is lost.`)
}

async function switchArgs(root: string, branch: string, mode: SwitchMode): Promise<string[] | GitQuickResult> {
  const name = await validBranchName(root, branch)
  if (mode === 'create') return name ? ['switch', '-c', name] : fail(`"${branch}" is not a valid branch name.`)
  const target = typeof branch === 'string' && !branch.startsWith('-') ? branch : null
  if (!target) return fail(`"${branch}" is not a valid branch name.`)
  if (mode === 'local') {
    return (await refExists(root, `refs/heads/${target}`)) ? ['switch', target] : fail(`There is no local branch ${target}.`)
  }
  return (await refExists(root, `refs/remotes/${target}`)) ? ['switch', '--track', target] : fail(`There is no remote branch ${target}.`)
}

async function switchBranch(root: string, request: Extract<GitQuickRequest, { op: 'switch' }>): Promise<GitQuickResult> {
  const args = await switchArgs(root, request.branch, request.mode)
  if (!Array.isArray(args)) return args
  const before = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  let stashed = false
  if (request.stash) {
    const pushed = await git(root, ['stash', 'push', '-u', '-m', stashMessage(new Date(), before)], QUICK_MS, false)
    if (!pushed.ok) return fail(pushed.message)
    stashed = !/no local changes/i.test(pushed.message)
  }
  const switched = await git(root, args, SLOW_MS)
  if (!switched.ok) {
    if (stashed) {
      const restored = await git(root, ['stash', 'pop'], QUICK_MS, false)
      if (!restored.ok) {
        return fail(`${switched.message}

Your changes are still in the stash: run "Apply last stash" after fixing the problem.`)
      }
    }
    return fail(switched.message, !request.stash && isDirtyRefusal(switched.message))
  }
  const target = request.mode === 'remote' ? request.branch.slice(request.branch.indexOf('/') + 1) : request.branch
  const tail = request.mode === 'create' ? ` from ${before}` : request.mode === 'remote' ? ` tracking ${request.branch}` : ''
  const note = stashed ? ' Your changes are stashed; run "Apply last stash" to bring them back.' : ''
  return done(`${request.mode === 'create' ? 'Created and switched to' : 'Switched to'} ${target}${tail}.${note}`)
}

async function dispatch(root: string, request: GitQuickRequest): Promise<GitQuickResult> {
  switch (request.op) {
    case 'pull':
      return pull(root)
    case 'fetch':
      return fetch(root)
    case 'stash':
      return stash(root)
    case 'stashPop':
      return stashPop(root)
    case 'switch':
      return switchBranch(root, request)
    default:
      return fail('Unknown git action.')
  }
}

export async function runGitQuick(request: GitQuickRequest): Promise<GitQuickResult> {
  const root = await repoRoot(request?.folder)
  if (!root) return fail(NOT_A_REPO)
  if (!tryLockRepo(root)) return fail(REPO_BUSY)
  try {
    return await dispatch(root, request)
  } finally {
    unlockRepo(root)
    forgetChanges()
  }
}
