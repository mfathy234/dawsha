import { basename, relativePath, type TimelineEvent } from './timeline'

export type OutputKind = 'new' | 'edited'

export interface SessionOutput {
  /** The path relative to the project folder, or the full path when the file lies outside it. */
  path: string
  name: string
  /** The folder the file sits in, empty for a file at the top of the project. */
  folder: string
  kind: OutputKind
  /** The last time the session wrote it. */
  at: number
  /** The file is inside the project, so Files can open it. */
  inProject: boolean
}

const isAbsolute = (path: string): boolean => /^(?:[a-z]:\/|\/|\\)/i.test(path)

const keyOf = (path: string): string => path.toLowerCase()

/**
 * The files a session wrote, newest first, from its log. A file counts as new when the first thing the session did to it
 * was write the whole file and the session had not read it before. A file the session deleted last is left out.
 */
export function sessionOutputs(events: readonly TimelineEvent[], base: string): SessionOutput[] {
  const read = new Set<string>()
  const seen = new Map<string, { kind: OutputKind; at: number; path: string; deleted: boolean }>()
  for (const event of events) {
    if (event.kind === 'read') {
      for (const path of event.paths ?? []) read.add(keyOf(relativePath(path, base)))
      continue
    }
    if (event.kind !== 'edit' || !event.path || event.editStatus === 'failed') continue
    const path = relativePath(event.path, base)
    const key = keyOf(path)
    const deleted = event.change?.deleted === true
    const earlier = seen.get(key)
    const created = earlier ? earlier.kind === 'new' : event.change?.whole === true && !deleted && !read.has(key)
    seen.set(key, { kind: created ? 'new' : 'edited', at: Math.max(event.at, earlier?.at ?? 0), path, deleted })
  }
  return [...seen.values()]
    .filter((entry) => !entry.deleted)
    .sort((a, b) => b.at - a.at)
    .map((entry) => {
      const cut = entry.path.lastIndexOf('/')
      const inProject = !isAbsolute(entry.path)
      return { path: entry.path, name: basename(entry.path), folder: cut > 0 ? entry.path.slice(0, cut) : '', kind: entry.kind, at: entry.at, inProject }
    })
}

export const outputsSignature = (outputs: readonly SessionOutput[]): string => outputs.map((output) => `${output.path}:${output.kind}:${output.at}`).join('|')
