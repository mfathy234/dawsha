import { api } from '../api'
import { normalizeFolder } from '../../shared/folderKey'
import { statusLetter } from '../../shared/gitStatus'

const MAX_AGE_MS = 15_000
const MAX_RECENT = 30

export interface FileIndex {
  files: string[]
  status: Map<string, string>
}

const cache = new Map<string, { at: number; index: FileIndex }>()
const recents = new Map<string, string[]>()
let subscribed = false

function subscribe(): void {
  if (subscribed) return
  subscribed = true
  api.onFilesChanged((key) => cache.delete(key))
}

/** A project's files (and git status letters), cached per folder and dropped when the watcher reports a change. */
export async function fileIndex(folder: string): Promise<FileIndex> {
  subscribe()
  const key = normalizeFolder(folder)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < MAX_AGE_MS) return hit.index
  const [listing, git] = await Promise.all([api.projectFiles(folder).catch(() => null), api.gitStatus(folder).catch(() => null)])
  const status = new Map<string, string>()
  if (git?.ok) for (const file of git.status.files) status.set(file.path, statusLetter(file))
  const index: FileIndex = { files: listing?.ok ? listing.files : [], status }
  if (listing?.ok) cache.set(key, { at: Date.now(), index })
  return index
}

export function noteOpened(folder: string, path: string): void {
  const key = normalizeFolder(folder)
  recents.set(key, [path, ...(recents.get(key) ?? []).filter((known) => known !== path)].slice(0, MAX_RECENT))
}

export const recentFiles = (folder: string): string[] => recents.get(normalizeFolder(folder)) ?? []
