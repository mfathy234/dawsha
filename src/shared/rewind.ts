import type { ChatItem } from './chatLog'

/** A file one message's reply, or a later reply, changed. */
export interface RewindFile {
  path: string
  added: number
  removed: number
  /** When the last reply that touched this file ended; a newer file on disk was changed by someone else. */
  touchedAt?: number
}

export interface RewindPlan {
  messageId: string
  messageText: string
  messageAt?: number
  files: RewindFile[]
  /** How many messages of yours, this one included, the rewind covers. */
  turns: number
}

/** What the main process found out about one file. */
export interface RewindFileInfo {
  path: string
  /** The snapshot does not hold it: the agent created it, so a rewind deletes it. */
  isNew: boolean
  /** The file on disk is newer than the reply that last touched it. */
  changedSince: boolean
}

export type RewindRow = RewindFile & { isNew: boolean; changedSince: boolean }

export const CHANGED_SLACK_MS = 5000

const isUser = (item: ChatItem): boolean => item.kind === 'message' && item.role === 'user'

/** The files that this user message's reply and every later reply changed, in the order they were first touched. */
export function rewindPlan(items: readonly ChatItem[], messageId: string): RewindPlan | null {
  const start = items.findIndex((item) => item.kind === 'message' && item.role === 'user' && item.id === messageId)
  const first = items[start]
  if (start < 0 || first.kind !== 'message') return null
  let files = new Map<string, RewindFile>()
  let turnPaths: string[] = []
  let turnEnd: number | undefined
  let turns = 0
  const close = (): void => {
    const next = new Map(files)
    for (const path of turnPaths) {
      const row = next.get(path)
      if (row && turnEnd !== undefined) next.set(path, { ...row, touchedAt: turnEnd })
    }
    files = next
    turnPaths = []
    turnEnd = undefined
  }
  for (let index = start; index < items.length; index += 1) {
    const item = items[index]
    if (isUser(item)) {
      if (index > start) close()
      turns += 1
    }
    if (item.at !== undefined) turnEnd = Math.max(turnEnd ?? 0, item.at)
    if (item.kind !== 'tool' || !item.done || item.failed || !item.path || (item.activity !== 'edit' && item.activity !== 'create')) continue
    const prior = files.get(item.path)
    files = new Map(files).set(item.path, { path: item.path, added: (prior?.added ?? 0) + (item.added ?? 0), removed: (prior?.removed ?? 0) + (item.removed ?? 0), ...(prior?.touchedAt !== undefined ? { touchedAt: prior.touchedAt } : {}) })
    turnPaths = [...turnPaths, item.path]
  }
  close()
  return { messageId, messageText: first.text, ...(first.at !== undefined ? { messageAt: first.at } : {}), files: [...files.values()], turns }
}

/** True when a file was written after the reply that last touched it ended. A missing file, or one with no known time, counts as unchanged. */
export function changedSince(mtimeMs: number | null, touchedAt: number | undefined, slackMs: number = CHANGED_SLACK_MS): boolean {
  return mtimeMs !== null && touchedAt !== undefined && mtimeMs > touchedAt + slackMs
}

export interface RewindSplit {
  put: RewindRow[]
  kept: RewindRow[]
}

const slash = (path: string): string => path.replace(/\\/g, '/')

/** Joins the plan's files with what the main process found; changed-since files are kept, the rest are put back. A file the main process did not report (outside the repository) is left out. */
export function splitRewind(files: readonly RewindFile[], infos: readonly RewindFileInfo[]): RewindSplit {
  const byPath = new Map(infos.map((info) => [slash(info.path), info]))
  const rows = files.flatMap((file): RewindRow[] => {
    const info = byPath.get(slash(file.path))
    return info ? [{ ...file, isNew: info.isNew, changedSince: info.changedSince }] : []
  })
  return { put: rows.filter((row) => !row.changedSince), kept: rows.filter((row) => row.changedSince) }
}

export function shortText(text: string, limit = 60): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

/** A file's name and the folder it is in, the folder shown relative to the project when the path lies inside it. */
export function displayPath(folder: string, path: string): { name: string; dir: string } {
  const full = slash(path)
  const root = slash(folder).replace(/\/+$/, '')
  const inside = root !== '' && full.toLowerCase().startsWith(`${root.toLowerCase()}/`)
  const rel = inside ? full.slice(root.length + 1) : full
  const cut = rel.lastIndexOf('/')
  return { name: cut < 0 ? rel : rel.slice(cut + 1), dir: cut < 0 ? '' : rel.slice(0, cut) }
}
