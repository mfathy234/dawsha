import { removeCopy, worktreeOfPane, type MergeOverview } from '../shared/mergeBack'
import { persistWorkspace } from './actions'
import { api } from './api'
import { confirmDialog } from './components/dialogs'
import { mergeBackDialog } from './components/mergeBackDialog'
import { toast } from './components/toast'
import { mapPane, paneById, store } from './state'

/** The worktree Dawsha made for a pane, when it has one. */
export const paneWorktree = (paneId: string) => {
  const pane = paneById(store.state, paneId)
  return pane ? worktreeOfPane(pane) : null
}

function sessionRunning(paneId: string): boolean {
  return (paneById(store.state, paneId)?.tabs ?? []).some((tab) => tab.status !== 'exited')
}

function forgetWorktree(paneId: string): void {
  store.set((s) => mapPane(s, paneId, (pane) => ({ ...pane, worktree: undefined, compare: pane.compare ? { ...pane.compare, sides: null } : undefined })))
  persistWorkspace()
}

async function confirmedRemoval(paneId: string, overview: MergeOverview): Promise<boolean> {
  const worktree = paneWorktree(paneId)
  if (!worktree) return false
  const copy = removeCopy(worktree.path, worktree.branch, { ahead: overview.ahead, dirtyFiles: overview.worktreeDirtyFiles })
  if (!(await confirmDialog({ title: copy.title, body: copy.body, confirmLabel: copy.confirmLabel }))) return false
  const result = await api.mergeRemove({ repo: worktree.repo, path: worktree.path, force: copy.force })
  if (!result.ok) {
    toast(result.error)
    return false
  }
  forgetWorktree(paneId)
  toast(`Removed ${worktree.path}.`, 'info')
  return true
}

/** Pane menu > Merge back…: for a pane working in a worktree Dawsha made. */
export async function openMergeBack(paneId: string): Promise<void> {
  const worktree = paneWorktree(paneId)
  if (!worktree) {
    toast('This session is not running in a worktree Dawsha made.', 'info')
    return
  }
  await mergeBackDialog({ worktree, sessionRunning: () => sessionRunning(paneId), removeWorktree: (overview) => confirmedRemoval(paneId, overview) })
}
