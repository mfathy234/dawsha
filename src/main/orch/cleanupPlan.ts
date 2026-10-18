export interface CleanupWorktree {
  path: string
  branch: string
  /** Uncommitted changes that removing the folder would destroy. */
  dirty: boolean
}

export interface CleanupBranch {
  name: string
  /** Reachable from the run's branch (task branches that were merged). */
  inRun: boolean
  /** Reachable from the base checkout's current branch. */
  inBase: boolean
  /** Reachable from a remote branch, so the work is on the server. */
  pushed: boolean
}

export interface CleanupPlan {
  removeWorktrees: CleanupWorktree[]
  deleteBranches: string[]
  /** Reasons, one per thing left behind. */
  kept: string[]
}

/** The reason a branch is safe to delete, or null when deleting it could lose commits. */
function safeBecause(branch: CleanupBranch, isRunBranch: boolean): string | null {
  if (branch.inBase) return 'merged into the base branch'
  if (branch.pushed) return 'pushed to a remote'
  if (!isRunBranch && branch.inRun) return 'merged into the run branch'
  return null
}

/**
 * Decides what a finished run's clean-up removes. Worktrees with uncommitted files stay, and so do their
 * branches; a branch is deleted only when none of its commits would be lost.
 */
export function planCleanup(runBranch: string, worktrees: readonly CleanupWorktree[], branches: readonly CleanupBranch[]): CleanupPlan {
  const kept: string[] = []
  const removeWorktrees: CleanupWorktree[] = []
  const held = new Set<string>()
  for (const tree of worktrees) {
    if (tree.dirty) {
      kept.push(`${tree.path} has uncommitted changes, so the folder and ${tree.branch} stay`)
      held.add(tree.branch)
    } else {
      removeWorktrees.push(tree)
    }
  }
  const deleteBranches: string[] = []
  for (const branch of branches) {
    if (held.has(branch.name)) continue
    if (safeBecause(branch, branch.name === runBranch)) deleteBranches.push(branch.name)
    else kept.push(`${branch.name} has commits that are neither merged nor pushed, so it stays`)
  }
  return { removeWorktrees, deleteBranches, kept }
}
