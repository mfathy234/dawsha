import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { git, removeWorktreeFolder } from '../compare'
import type { GitRun } from '../compare'

export interface OrchWorktree {
  path: string
  branch: string
}

export interface MergeOutcome {
  ok: boolean
  conflict: boolean
  message: string
}

const SHORT_LENGTH = 8
const ORCH_BRANCH = /^orch\/[A-Za-z0-9]+(\/[a-z0-9][a-z0-9._-]*)?$/
const FALLBACK_IDENTITY = ['-c', 'user.name=Dawsha', '-c', 'user.email=dawsha@localhost.invalid']

const shortOf = (runId: string): string => runId.replace(/^run_/, '').slice(0, SHORT_LENGTH)

export const runBranch = (runId: string): string => `orch/${shortOf(runId)}/run`

export const taskBranch = (runId: string, taskKey: string): string => `orch/${shortOf(runId)}/${taskKey.toLowerCase()}`

export const isOrchBranch = (name: string): boolean => ORCH_BRANCH.test(name)

const siblingPath = (repo: string, suffix: string): string => join(dirname(repo), `${basename(repo)}-orch-${suffix}`)

const message = (run: GitRun, fallback: string): string => run.stderr || run.stdout || fallback

async function mustGit(args: string[], cwd: string, fallback: string): Promise<GitRun> {
  const run = await git(args, cwd)
  if (!run.ok) throw new Error(message(run, fallback))
  return run
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  return (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repo)).ok
}

export async function ensureRunBranch(repo: string, runId: string): Promise<string> {
  const branch = runBranch(runId)
  if (await branchExists(repo, branch)) return branch
  await mustGit(['branch', branch, 'HEAD'], repo, `git could not create the branch ${branch}.`)
  return branch
}

async function ensureWorktree(repo: string, path: string, branch: string, base: string): Promise<OrchWorktree> {
  if (existsSync(path)) {
    const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], path)
    if (head.ok && head.stdout === branch) return { path, branch }
    throw new Error(`The folder ${path} already exists but is not the worktree for ${branch}.`)
  }
  await git(['worktree', 'prune'], repo)
  const args = (await branchExists(repo, branch))
    ? ['worktree', 'add', path, branch]
    : ['worktree', 'add', '-b', branch, path, base]
  await mustGit(args, repo, `git could not create the worktree ${path}.`)
  return { path, branch }
}

export async function createTaskWorktree(repo: string, runId: string, taskKey: string): Promise<OrchWorktree> {
  const base = await ensureRunBranch(repo, runId)
  const branch = taskBranch(runId, taskKey)
  return ensureWorktree(repo, siblingPath(repo, `${shortOf(runId)}-${taskKey.toLowerCase()}`), branch, base)
}

export async function runWorktree(repo: string, runId: string): Promise<OrchWorktree> {
  const branch = await ensureRunBranch(repo, runId)
  return ensureWorktree(repo, siblingPath(repo, shortOf(runId)), branch, branch)
}

async function identityArgs(cwd: string): Promise<string[]> {
  const name = await git(['config', 'user.name'], cwd)
  const email = await git(['config', 'user.email'], cwd)
  return name.ok && name.stdout && email.ok && email.stdout ? [] : FALLBACK_IDENTITY
}

export async function mergeTaskIntoRun(repo: string, runId: string, taskKey: string): Promise<MergeOutcome> {
  let run: OrchWorktree
  try {
    run = await runWorktree(repo, runId)
  } catch (error) {
    return { ok: false, conflict: false, message: (error as Error).message }
  }
  const branch = taskBranch(runId, taskKey)
  if (!(await branchExists(repo, branch))) {
    return { ok: false, conflict: false, message: `The task branch ${branch} does not exist.` }
  }
  const identity = await identityArgs(run.path)
  const merged = await git([...identity, 'merge', '--no-ff', '--no-edit', branch], run.path)
  if (merged.ok) return { ok: true, conflict: false, message: merged.stdout }
  const unmerged = await git(['diff', '--name-only', '--diff-filter=U'], run.path)
  const conflict = unmerged.ok && unmerged.stdout !== ''
  const aborted = await git(['merge', '--abort'], run.path)
  const detail = message(merged, `git could not merge ${branch}.`)
  if (!aborted.ok && conflict) await git(['reset', '--hard', 'HEAD'], run.path)
  return { ok: false, conflict, message: detail }
}

export async function removeOrchWorktree(
  repo: string,
  path: string,
  branch: string,
  opts: { deleteBranch?: boolean } = {}
): Promise<void> {
  if (!isOrchBranch(branch) || !basename(path).includes('-orch-')) {
    throw new Error('Dawsha only removes worktrees and branches it created for an orchestrator run.')
  }
  if (existsSync(path)) {
    const problem = await removeWorktreeFolder(repo, path, true)
    if (problem) throw new Error(problem)
  }
  await git(['worktree', 'prune'], repo)
  if (!opts.deleteBranch) return
  const deleted = await git(['branch', '-D', branch], repo)
  if (!deleted.ok && !/not found/i.test(deleted.stderr)) {
    throw new Error(message(deleted, `git could not delete ${branch}.`))
  }
}
