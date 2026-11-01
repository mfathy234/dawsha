import { applyStashPane, fetchPane, paneFolder, pullPane, stashPane } from '../gitQuickActions'
import { openBranchSwitcher } from '../files/branchSwitcher'
import type { BranchMenuExtra } from '../files/branchMenu'
import { ICONS } from '../icons'

/** The pane footer's branch chip: the branch switcher (with the stash guard), and Pull, Stash changes, Apply last stash and Fetch below it. */
export function openPaneBranchMenu(paneId: string, anchor: HTMLElement): void {
  const folder = paneFolder(paneId)
  if (!folder) return
  const extra = (id: string, label: string, svg: string, action: (id: string) => Promise<void>): BranchMenuExtra => ({
    id, label, icon: svg, run: () => void action(paneId)
  })
  void openBranchSwitcher({
    folder,
    anchor,
    extras: [
      extra('pull', 'Pull', ICONS.download, pullPane),
      extra('stash', 'Stash changes', ICONS.commit, stashPane),
      extra('stash-pop', 'Apply last stash', ICONS.history, applyStashPane),
      extra('fetch', 'Fetch', ICONS.download, fetchPane)
    ]
  })
}
