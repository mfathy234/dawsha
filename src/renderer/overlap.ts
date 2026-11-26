import { collectEdits } from '../shared/fileActivity'
import { findOverlaps, warningKey, type OverlapEdit, type OverlapWarning } from '../shared/fileOverlap'
import { isAbsolutePath } from '../shared/linkedRepos'
import { normalizeFolder } from '../shared/folderKey'
import { api } from './api'
import { derivePanes, workFolderOfPane, type PaneView } from './derive'
import { store } from './state'
import { timelineRequest } from './timelineActions'

const TICK_MS = 6000

let warnings: readonly OverlapWarning[] = []
const dismissed = new Set<string>()
const lastEdits = new Map<string, OverlapEdit[]>()
const wasBusy = new Set<string>()
let running = false

/** The warnings a pane shows: files another session in the same checkout changed, minus the ones dismissed. */
export const overlapWarningsFor = (paneId: string): OverlapWarning[] => warnings.filter((warning) => warning.paneId === paneId && !dismissed.has(warningKey(warning)))

/** True while some session shows a warning for this file, so Review can mark it. */
export const isOverlappedFile = (file: string): boolean => warnings.some((warning) => warning.file === file && !dismissed.has(warningKey(warning)))

export function dismissOverlap(paneId: string, file: string): void {
  dismissed.add(warningKey({ paneId, file }))
  store.patch({})
}

const sameCheckoutGroups = (views: readonly PaneView[]): Map<string, PaneView[]> => {
  const groups = new Map<string, PaneView[]>()
  for (const view of views) {
    if (view.agent === 'shell' || view.status === 'exited') continue
    const folder = workFolderOfPane(store.state, view.pane)
    if (!folder) continue
    const key = normalizeFolder(folder)
    groups.set(key, [...(groups.get(key) ?? []), view])
  }
  return new Map([...groups].filter(([, members]) => members.length > 1))
}

async function editsOf(view: PaneView, folder: string): Promise<OverlapEdit[]> {
  const request = timelineRequest(view.pane.id)
  if (!request) return []
  const result = await api.sessionTimeline({ ...request, version: undefined }).catch(() => null)
  if (result?.status !== 'ok') return lastEdits.get(view.pane.id) ?? []
  const edits: OverlapEdit[] = []
  for (const [file, records] of collectEdits(result.events, folder)) {
    if (isAbsolutePath(file) || file.startsWith('..')) continue
    const at = Math.max(...records.map((record) => record.at))
    edits.push({ paneId: view.pane.id, checkout: folder, file, at })
  }
  lastEdits.set(view.pane.id, edits)
  return edits
}

async function refresh(): Promise<void> {
  if (running) return
  running = true
  try {
    const views = derivePanes(store.state)
    const groups = sameCheckoutGroups(views)
    const edits: OverlapEdit[] = []
    for (const members of groups.values()) {
      const worth = members.some((view) => view.status === 'busy' || wasBusy.has(view.pane.id) || !lastEdits.has(view.pane.id))
      for (const view of members) {
        const folder = workFolderOfPane(store.state, view.pane)
        if (!folder) continue
        edits.push(...(worth ? await editsOf(view, folder) : (lastEdits.get(view.pane.id) ?? [])))
      }
    }
    wasBusy.clear()
    for (const view of views) if (view.status === 'busy') wasBusy.add(view.pane.id)
    for (const id of [...lastEdits.keys()]) if (!views.some((view) => view.pane.id === id)) lastEdits.delete(id)
    const next = findOverlaps(edits, Date.now())
    const same = next.length === warnings.length && next.every((warning, index) => warningKey(warning) === warningKey(warnings[index]) && warning.at === warnings[index].at && warning.otherPaneId === warnings[index].otherPaneId)
    warnings = next
    if (!same) store.patch({})
  } finally {
    running = false
  }
}

/** Looks for files two sessions in the same checkout edit, every few seconds while they share one. */
export function installOverlap(): void {
  window.setInterval(() => void refresh(), TICK_MS)
}
