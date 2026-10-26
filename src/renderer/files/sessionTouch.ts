import { api } from '../api'
import { derivePanes } from '../derive'
import { folderOfPane, store } from '../state'
import { timelineRequest } from '../timelineActions'
import { relativePath } from '../../shared/timeline'
import { toRepoPath } from '../../shared/projectPaths'

export interface TouchingSession {
  paneId: string
  title: string
  edits: number
}

export type TouchMap = ReadonlyMap<string, TouchingSession[]>

const sameFolder = (a: string, b: string): boolean => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

/** Which open sessions of this project edited which files, from the edit events their timelines already parse. */
export async function loadTouches(projectId: string, folder: string, prefix = ''): Promise<TouchMap> {
  const state = store.state
  const views = derivePanes(state).filter((view) => view.pane.projectId === projectId && view.agent !== 'shell')
  const touches = new Map<string, TouchingSession[]>()
  await Promise.all(
    views.map(async (view) => {
      const request = timelineRequest(view.pane.id)
      const paneFolder = folderOfPane(state, view.pane)
      if (!request || !paneFolder) return
      const result = await api.sessionTimeline({ ...request, version: undefined }).catch(() => null)
      if (result?.status !== 'ok') return
      const base = sameFolder(paneFolder, folder) ? folder : paneFolder
      const counts = new Map<string, number>()
      for (const event of result.events) {
        if (event.kind !== 'edit' || !event.path) continue
        const rel = toRepoPath(prefix, relativePath(event.path, base))
        counts.set(rel, (counts.get(rel) ?? 0) + 1)
      }
      for (const [path, edits] of counts) touches.set(path, [...(touches.get(path) ?? []), { paneId: view.pane.id, title: view.title, edits }])
    })
  )
  return touches
}
