import type { EditChange } from './editChange'
import { locateEdits } from './editLocate'
import { relativePath, type TimelineEvent } from './timeline'
import { toRepoPath } from './projectPaths'

export interface EditRecord {
  at: number
  added: number
  removed: number
  /** The prompt the agent was working on when it made the edit. */
  task: string
  /** The text the edit wrote, when the transcript carried it. */
  change?: EditChange
}

export interface BlameSource {
  key: string
  label: string
  /** The agent kind (claude, codex, gemini) when known, for its mark in the gutter. */
  agent?: string
  edits: readonly EditRecord[]
}

export interface LineBlame {
  key: string
  label: string
  agent?: string
  task: string
  at: number
  /** The line was found in the file from the edit's own text; false means it is an estimate from edit counts. */
  exact: boolean
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
    out.set(path, [...(out.get(path) ?? []), { at: event.at, added: event.added ?? 0, removed: event.removed ?? 0, task, ...(event.change ? { change: event.change } : {}) }])
  }
  return out
}

/**
 * The old estimate: a timeline records how many lines each edit added, not where, so lines are handed out in file order
 * to the edits in time order. One session alone owns every added line. Lines nothing accounts for get no mark.
 */
function estimateLines(addedLines: readonly number[], sources: readonly BlameSource[], solo: boolean): Map<number, LineBlame> {
  const out = new Map<number, LineBlame>()
  const active = sources.filter((source) => source.edits.length > 0)
  if (addedLines.length === 0 || active.length === 0) return out
  const lines = [...addedLines].sort((a, b) => a - b)
  if (solo && active.length === 1) {
    const [only] = active
    const last = only.edits.reduce((latest, edit) => (edit.at >= latest.at ? edit : latest))
    for (const line of lines) out.set(line, { key: only.key, label: only.label, agent: only.agent, task: last.task, at: last.at, exact: false })
    return out
  }
  const ordered = active
    .flatMap((source) => source.edits.map((edit) => ({ source, edit })))
    .filter(({ edit }) => edit.added > 0)
    .sort((a, b) => a.edit.at - b.edit.at)
  let next = 0
  for (const { source, edit } of ordered) {
    for (let i = 0; i < edit.added && next < lines.length; i += 1, next += 1) out.set(lines[next], { key: source.key, label: source.label, agent: source.agent, task: edit.task, at: edit.at, exact: false })
  }
  return out
}

/**
 * Which session wrote which added line. With the file's text, each edit's own new text is found in the file, so those
 * lines are exact; edits that cannot be found that way fall back to the estimate over the lines left, marked as such.
 */
export function blameLines(addedLines: readonly number[], sources: readonly BlameSource[], text?: string): Map<number, LineBlame> {
  const solo = sources.filter((source) => source.edits.length > 0).length === 1
  if (text === undefined) return estimateLines(addedLines, sources, solo)
  const flat = sources.flatMap((source) => source.edits.map((edit) => ({ source, edit })))
  const located = locateEdits(text, flat.map(({ edit }) => ({ at: edit.at, change: edit.change })))
  const out = new Map<number, LineBlame>()
  const wanted = new Set(addedLines)
  for (const [line, index] of located.owners) {
    if (!wanted.has(line)) continue
    const { source, edit } = flat[index]
    out.set(line, { key: source.key, label: source.label, agent: source.agent, task: edit.task, at: edit.at, exact: true })
  }
  const unplaced = new Map<BlameSource, EditRecord[]>()
  flat.forEach(({ source, edit }, index) => {
    if (!located.estimate.has(index)) return
    const rest = Math.max(0, edit.added - (located.placed.get(index) ?? 0))
    unplaced.set(source, [...(unplaced.get(source) ?? []), { ...edit, added: rest }])
  })
  const remaining = addedLines.filter((line) => !located.owners.has(line))
  const rough = estimateLines(remaining, [...unplaced].map(([source, edits]) => ({ ...source, edits })), solo)
  for (const [line, blame] of rough) out.set(line, blame)
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
