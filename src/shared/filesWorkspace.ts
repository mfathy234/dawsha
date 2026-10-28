import { normalizeFolder } from './folderKey'

export interface FilesCheckout {
  folder: string
  branch: string
  head: string
  detached: boolean
  unavailable: boolean
  main: boolean
}
export type FilesWorkspacesResult = { ok: true; git: boolean; folder: string; checkouts: FilesCheckout[] } | { ok: false; error: string }
export type FilesTrashResult = { ok: true } | { ok: false; error: string }
export const checkoutTabsKey = (projectId: string, folder: string): string => `${projectId}|${normalizeFolder(folder)}`
export const checkoutLabel = (checkout: FilesCheckout): string => `${checkout.detached ? `Detached · ${checkout.head.slice(0, 8)}` : checkout.branch || 'Folder · No Git branch'} · ${checkout.folder.replace(/\\/g, '/').split('/').pop()}${checkout.unavailable ? ' (unavailable)' : ''}`

const folderTail = (folder: string): string => folder.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? folder

/** The second line of the location button: branch and worktree folder; empty for a folder that is not a git checkout. */
export function branchLine(checkout: FilesCheckout | undefined, git = true): string {
  if (!checkout || !git) return ''
  const branch = checkout.detached ? `Detached · ${checkout.head.slice(0, 8)}` : checkout.branch
  if (!branch) return ''
  return `${branch} · ${folderTail(checkout.folder)}`
}

/** Why a checkout in the location menu cannot be chosen. */
export const unavailableReason = (checkout: FilesCheckout): string => (checkout.unavailable ? 'Folder is missing or the worktree was pruned' : '')

/** The line a checkout shows in the menu: its branch, or what it is when there is none. */
export const checkoutTitle = (checkout: FilesCheckout): string => (checkout.detached ? `Detached · ${checkout.head.slice(0, 8)}` : checkout.branch || folderTail(checkout.folder))

export const checkoutFolderName = folderTail
