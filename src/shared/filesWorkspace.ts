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
