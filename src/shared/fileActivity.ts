import { relativePath, type TimelineEvent } from './timeline'
import { toRepoPath } from './projectPaths'

export interface EditRecord {
  at: number
  added: number
  removed: number
  /** The prompt the agent was working on when it made the edit. */
  task: string
}

export interface BlameSource {
  key: string
  label: string
  edits: readonly EditRecord[]
}

export interface LineBlame {
  key: string
  label: string
  task: string
  at: number
}

const TASK_CHARS = 120

const shorten = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > TASK_CHARS ? `${flat.slice(0, TASK_CHARS - 1)}…` : flat
}

/** The edits a session's timeline records, by repo-relative path, each with the prompt that was current at the time. */
export function collectEdits(events: readonly TimelineEvent[], base: string, prefix = ''): Map<string, EditRecord[]> {
  const out = new Map<string, EditRecord[]>()
  let task = ''
  for (const event of events) {
    if (event.kind === 'prompt') task = shorten(event.text)
    if (event.kind !== 'edit' || !event.path) continue
    const path = toRepoPath(prefix, relativePath(event.path, base))
    out.set(path, [...(out.get(path) ?? []), { at: event.at, added: event.added ?? 0, removed: event.removed ?? 0, task }])
  }
  return out
}

/**
 * Which session wrote which added line. A timeline records how many lines each edit added, not where, so lines are
 * handed out in file order to the edits in time order; this is an estimate. One session alone owns every added line.
 * Lines nothing accounts for get no mark.
 */
export function blameLines(addedLines: readonly number[], sources: readonly BlameSource[]): Map<number, LineBlame> {
  const out = new Map<number, LineBlame>()
  const active = sources.filter((source) => source.edits.length > 0)
  if (addedLines.length === 0 || active.length === 0) return out
  const lines = [...addedLines].sort((a, b) => a - b)
  if (active.length === 1) {
    const [only] = active
    const last = only.edits.reduce((latest, edit) => (edit.at >= latest.at ? edit : latest))
    for (const line of lines) out.set(line, { key: only.key, label: only.label, task: last.task, at: last.at })
    return out
  }
  const ordered = active
    .flatMap((source) => source.edits.map((edit) => ({ source, edit })))
    .filter(({ edit }) => edit.added > 0)
    .sort((a, b) => a.edit.at - b.edit.at)
  let next = 0
  for (const { source, edit } of ordered) {
    for (let i = 0; i < edit.added && next < lines.length; i += 1, next += 1) out.set(lines[next], { key: source.key, label: source.label, task: edit.task, at: edit.at })
  }
  return out
}

/** How long ago, in the plain words a list needs. */
export function ago(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
