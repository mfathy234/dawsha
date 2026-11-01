import { switchPlan, type GitQuickResult, type SwitchMode } from '../shared/gitBranches'
import { api } from './api'
import { stashDialog } from './components/stashDialog'
import { toast } from './components/toast'
import { runQuick } from './gitQuickActions'

export interface BranchChoice {
  branch: string
  mode: SwitchMode
}

/** The branch name as people read it: `origin/main` is branch `main`. */
export function branchLabel(choice: BranchChoice): string {
  return choice.mode === 'remote' ? choice.branch.slice(choice.branch.indexOf('/') + 1) : choice.branch
}

/**
 * The one way every branch switch in the UI runs. A clean tree switches at once; uncommitted changes are blocked behind the stash dialog;
 * a new branch carries the changes along and needs no guard. Shows the outcome as a toast. Returns null when the user cancelled
 * or the check failed, otherwise git's result.
 */
export async function switchBranchGuarded(folder: string, choice: BranchChoice): Promise<GitQuickResult | null> {
  let plan = { stash: false, stashUntracked: false }
  if (choice.mode !== 'create') {
    const dirty = await api.gitDirty(folder).catch(() => ({ ok: false as const, error: 'Could not check for uncommitted changes.' }))
    if (!dirty.ok) {
      toast(dirty.error)
      return null
    }
    const { report } = dirty
    if (report.modified > 0 || report.untracked > 0) {
      const answer = await stashDialog(branchLabel(choice), report)
      if (!answer) return null
      plan = switchPlan(report, answer.includeNew)
    }
  }
  const result = await runQuick({ folder, op: 'switch', branch: choice.branch, mode: choice.mode, ...plan })
  if (result.ok) toast(result.message, 'info')
  else toast(result.error)
  return result
}
