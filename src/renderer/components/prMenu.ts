import { effectiveMergeCommand } from '../../shared/prSettings'
import { PR_LINK_ONLY_NOTE } from '../../shared/prWatch'
import { editMergeCommand, fixAutoOn, fixCi, mergeWhenGreenOn, openPullRequest, prStateOf, projectPrSettings, toggleFixAuto, toggleMergeWhenGreen, toggleTidyUp } from '../prWatch'
import { paneById, store } from '../state'
import { openContextMenu, type ContextEntry } from './contextMenu'

/** What the pull request button of a session can do. */
export function prMenuEntries(paneId: string): ContextEntry[] {
  const state = prStateOf(paneId)
  const pane = paneById(store.state, paneId)
  if (!state || !pane) return []
  const open: ContextEntry = { label: `Open PR #${state.number}`, run: () => openPullRequest(paneId) }
  if (state.phase === 'link') return [open, { label: 'Status is not shown', disabled: true, detail: PR_LINK_ONLY_NOTE, run: () => undefined }]
  const project = projectPrSettings(pane.projectId)
  const failing = state.failedCount > 0
  return [
    open,
    'separator',
    { label: 'Fix CI', disabled: !failing, detail: failing ? 'Send the failed checks to the session' : 'No check is failing', run: () => void fixCi(paneId) },
    { label: 'Fix CI automatically', current: fixAutoOn(paneId), detail: 'Once for each failing commit', run: () => toggleFixAuto(paneId) },
    'separator',
    { label: 'Merge when green', current: mergeWhenGreenOn(paneId), detail: effectiveMergeCommand(project).replace('<n>', String(state.number)), run: () => void toggleMergeWhenGreen(paneId) },
    { label: 'Change the merge command', run: () => void editMergeCommand(pane.projectId) },
    'separator',
    { label: 'Tidy up after a merge', current: project.tidyUp, detail: 'Close the session and remove its worktree, for this project', run: () => toggleTidyUp(pane.projectId) }
  ]
}

export function openPrMenu(paneId: string, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  openContextMenu({ x: rect.left, y: rect.bottom, label: 'Pull request', entries: prMenuEntries(paneId), returnFocus: anchor, anchor: rect })
}
