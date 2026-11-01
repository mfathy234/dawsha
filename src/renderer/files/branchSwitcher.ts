import { branchNameProblem } from '../../shared/gitBranches'
import { api } from '../api'
import { promptDialog } from '../components/dialogs'
import { toast } from '../components/toast'
import { switchBranchGuarded, type BranchChoice } from '../gitSwitch'
import { branchMenuOpenFor, closeBranchListMenu, openBranchListMenu, type BranchMenuExtra } from './branchMenu'

export interface BranchSwitcherOptions {
  folder: string
  anchor: HTMLElement
  extras?: readonly BranchMenuExtra[]
  /** The menu is about to show (true) or has closed (false), for the opener's expanded state. */
  open?(open: boolean): void
  /** A switch or a new branch went through. */
  switched?(): void
}

/** Asks for a name, then creates the branch from the current commit and switches to it (the changes come along). */
export async function createBranchFlow(folder: string): Promise<BranchChoice | null> {
  const name = await promptDialog({
    title: 'New branch', label: 'Branch name', hint: 'Created from the current commit and switched to.', confirmLabel: 'Create branch',
    validate: (value) => branchNameProblem(value.trim())
  })
  return name ? { branch: name.trim(), mode: 'create' } : null
}

/**
 * The branch menu for a folder, shared by the Files sidebar and the pane footer. Every pick goes through the stash guard.
 * Clicking the same button again closes the menu.
 */
export async function openBranchSwitcher(options: BranchSwitcherOptions): Promise<void> {
  const { folder, anchor } = options
  if (branchMenuOpenFor(anchor)) {
    closeBranchListMenu(true)
    return
  }
  const loaded = await api.gitBranches(folder).catch(() => ({ ok: false as const, error: 'Could not read the branches.' }))
  if (!loaded.ok) {
    toast(loaded.error)
    return
  }
  const run = async (choice: BranchChoice | null): Promise<void> => {
    if (!choice) return
    const result = await switchBranchGuarded(folder, choice)
    if (result?.ok) options.switched?.()
  }
  options.open?.(true)
  openBranchListMenu({
    anchor, list: loaded.branches, now: Date.now(), extras: options.extras,
    pick: (choice) => void run(choice),
    create: () => void createBranchFlow(folder).then(run),
    closed: (focusAnchor) => {
      options.open?.(false)
      if (focusAnchor) anchor.focus()
    }
  })
}
