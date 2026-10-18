import { basename } from 'node:path'
import { git } from '../compare'
import type { RunCleanup } from '../../shared/orch/types'
import { planCleanup, type CleanupBranch, type CleanupWorktree } from './cleanupPlan'
import { isOrchBranch, removeOrchWorktree, runBranch, runPrefix } from './worktrees'

interface ListedWorktree {
  path: string
  branch: string
}

/** Worktrees git lists that carry one of this run's branches and sit in a folder Dawsha named. */
async function runWorktrees(repo: string, prefix: string): Promise<ListedWorktree[]> {
  const listed = await git(['worktree', 'list', '--porcelain'], repo)
  if (!listed.ok) return []
  const found: ListedWorktree[] = []
  for (const block of listed.stdout.split(/\r?\n\r?\n/)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]
    if (path && branch && branch.startsWith(prefix) && isOrchBranch(branch) && basename(path).includes('-orch-')) found.push({ path, branch })
  }
  return found
}

async function isDirty(path: string): Promise<boolean> {
  const status = await git(['status', '--porcelain'], path)
  return !status.ok || status.stdout !== ''
}

const reaches = async (repo: string, ancestor: string, tip: string): Promise<boolean> =>
  (await git(['merge-base', '--is-ancestor', ancestor, tip], repo)).ok

async function branchFacts(repo: string, name: string, run: string): Promise<CleanupBranch> {
  const remotes = await git(['branch', '-r', '--contains', name], repo)
  return {
    name,
    inRun: name !== run && await reaches(repo, name, run),
    inBase: await reaches(repo, name, 'HEAD'),
    pushed: remotes.ok && remotes.stdout !== ''
  }
}

async function runBranches(repo: string, prefix: string): Promise<string[]> {
  const listed = await git(['for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}`], repo)
  return listed.ok ? listed.stdout.split(/\r?\n/).filter((name) => name !== '' && isOrchBranch(name)) : []
}

/**
 * Removes every worktree the run created and deletes its orch branches that are merged or pushed. Unmerged
 * branches and worktrees with uncommitted files are kept and reported. Safe to run again to retry.
 */
export async function cleanUpRun(repo: string, runId: string, now: () => number = Date.now): Promise<RunCleanup> {
  const prefix = runPrefix(runId)
  const run = runBranch(runId)
  const trees: CleanupWorktree[] = []
  for (const tree of await runWorktrees(repo, prefix)) trees.push({ ...tree, dirty: await isDirty(tree.path) })
  const names = await runBranches(repo, prefix)
  const branches = await Promise.all(names.map((name) => branchFacts(repo, name, run)))
  const plan = planCleanup(run, trees, branches)
  const failed: string[] = []
  let removed = 0
  const stuck = new Set<string>()
  for (const tree of plan.removeWorktrees) {
    try {
      await removeOrchWorktree(repo, tree.path, tree.branch)
      removed += 1
    } catch (error) {
      stuck.add(tree.branch)
      failed.push(`${tree.path}: ${(error as Error).message}`)
    }
  }
  await git(['worktree', 'prune'], repo)
  const deletedBranches: string[] = []
  for (const name of plan.deleteBranches.filter((branch) => !stuck.has(branch))) {
    const deleted = await git(['branch', '-D', name], repo)
    if (deleted.ok) deletedBranches.push(name)
    else failed.push(`${name}: ${deleted.stderr}`)
  }
  return { at: now(), removed, deletedBranches, kept: plan.kept, failed }
}
