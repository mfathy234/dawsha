import type { GitQuickRequest, GitQuickResult } from '../shared/gitBranches'
import { api } from './api'
import { refreshBranches, refreshGitChanges } from './actions'
import { openBranchPicker } from './components/branchPicker'
import { toast } from './components/toast'
import { workFolderOfPane } from './derive'
import { paneById, store } from './state'

const NO_REPO = 'This pane folder is not a git repository.'

type SimpleOp = 'pull' | 'fetch' | 'stash' | 'stashPop'

export function paneFolder(paneId: string): string | null {
  const pane = paneById(store.state, paneId)
  const folder = pane ? workFolderOfPane(store.state, pane) : null
  if (!folder) return null
  if (store.state.gitChanges[folder] == null) {
    toast(NO_REPO)
    return null
  }
  return folder
}

export async function runQuick(request: GitQuickRequest): Promise<GitQuickResult> {
  const result = await api.gitQuick(request)
  void refreshBranches()
  void refreshGitChanges()
  return result
}

async function report(paneId: string, op: SimpleOp): Promise<void> {
  const folder = paneFolder(paneId)
  if (!folder) return
  const result = await runQuick({ folder, op })
  if (result.ok) toast(result.message, 'info')
  else toast(result.error)
}

export const pullPane = (paneId: string): Promise<void> => report(paneId, 'pull')
export const fetchPane = (paneId: string): Promise<void> => report(paneId, 'fetch')
export const stashPane = (paneId: string): Promise<void> => report(paneId, 'stash')
export const applyStashPane = (paneId: string): Promise<void> => report(paneId, 'stashPop')

export async function switchBranchPane(paneId: string): Promise<void> {
  const folder = paneFolder(paneId)
  if (folder) await openBranchPicker(folder)
}
