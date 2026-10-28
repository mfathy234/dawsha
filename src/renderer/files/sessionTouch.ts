import { api } from '../api'
import { derivePanes } from '../derive'
import { folderOfPane, store } from '../state'
import { timelineRequest } from '../timelineActions'
import { relativePath } from '../../shared/timeline'
import { toRepoPath } from '../../shared/projectPaths'
import { collectEdits, type EditRecord } from '../../shared/fileActivity'
import { externalFolders, isAbsolutePath } from '../../shared/linkedRepos'

export interface TouchingSession {
  paneId: string
  title: string
  /** Edit events this session made to the file. */
  edits: number
  /** Read events (the file was opened by the agent but not changed). */
  reads: number
  /** Each edit with the task and time, for blame and the Activity tab. */
  records: EditRecord[]
  /** The session's terminal is still running. */
  live: boolean
}

export type TouchMap = ReadonlyMap<string, TouchingSession[]>

export interface SessionData {
  touches: TouchMap
  /** Folders outside this project that the sessions touched, for Linked repos. */
  external: string[]
}

const sameFolder = (a: string, b: string): boolean => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

/** Live sessions first, then the one that edited most. */
export const orderSessions = (sessions: readonly TouchingSession[]): TouchingSession[] =>
  [...sessions].sort((a, b) => Number(b.live) - Number(a.live) || b.edits - a.edits || a.title.localeCompare(b.title))

/** Which open sessions of this project edited or read which files, from the events their timelines already parse. */
export async function loadSessionData(projectId: string, folder: string, prefix = '', checkouts: readonly string[] = []): Promise<SessionData> {
  const state = store.state
  const views = derivePanes(state).filter((view) => view.pane.projectId === projectId && view.agent !== 'shell')
  const touches = new Map<string, TouchingSession[]>()
  const outside: string[] = []
  await Promise.all(
    views.map(async (view) => {
      const request = timelineRequest(view.pane.id)
      const paneFolder = folderOfPane(state, view.pane)
      if (!request || !paneFolder) return
      const result = await api.sessionTimeline({ ...request, version: undefined }).catch(() => null)
      if (result?.status !== 'ok') return
      const base = sameFolder(paneFolder, folder) ? folder : paneFolder
      const edits = collectEdits(result.events, base, prefix)
      const reads = new Map<string, number>()
      for (const event of result.events) {
        for (const path of event.kind === 'read' ? (event.paths ?? (event.path ? [event.path] : [])) : []) {
          const rel = toRepoPath(prefix, relativePath(path, base))
          reads.set(rel, (reads.get(rel) ?? 0) + 1)
        }
        if (event.path && (event.kind === 'edit' || event.kind === 'read')) outside.push(event.path)
        if (event.paths) outside.push(...event.paths)
      }
      const live = !view.activeExited
      for (const path of new Set([...edits.keys(), ...reads.keys()])) {
        if (isAbsolutePath(path)) continue
        const records = edits.get(path) ?? []
        touches.set(path, [...(touches.get(path) ?? []), { paneId: view.pane.id, title: view.title, edits: records.length, reads: reads.get(path) ?? 0, records, live }])
      }
    })
  )
  return { touches, external: externalFolders(outside, folder, checkouts) }
}
