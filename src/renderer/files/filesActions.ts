import { api } from '../api'
import { focusPane, showView } from '../actions'
import { confirmDialog } from '../components/dialogs'
import { toast } from '../components/toast'
import { unsavedQuitCopy } from '../../shared/dirtyFiles'
import { folderOfPane, paneById, store, type AppState } from '../state'
import { paneTerminal } from '../terminalActions'

export interface FilesTarget {
  projectId: string
  folder: string
}

export interface FilesRequest extends FilesTarget {
  path: string
  pin: boolean
  line?: number
}

export interface LineRange {
  start: number
  end: number
}

let current: FilesTarget | null = null
let dirtyProvider: () => string[] = () => []

/** The Files view reports which open files have unsaved edits, so closing the window can ask first. */
export function setDirtyProvider(provider: () => string[]): void {
  dirtyProvider = provider
}

export const unsavedFiles = (): string[] => dirtyProvider()

/** Asked as the window closes: with unsaved Files tabs it names them and keeps Cancel as the default. */
export async function confirmQuitWithUnsavedFiles(): Promise<boolean> {
  const dirty = [...new Set(unsavedFiles())]
  if (dirty.length === 0) return true
  return confirmDialog(unsavedQuitCopy(dirty))
}
let pending: FilesRequest | null = null
const listeners = new Set<() => void>()

/** The project and folder the Files view is showing (set by the view while it is open). */
export function setCurrentTarget(target: FilesTarget | null): void {
  current = target
}

/** Where Files and quick open should look: the open view's project, else the focused session's, else the first project. */
export function filesTarget(state: AppState = store.state): FilesTarget | null {
  if (state.view === 'files' && current) return current
  const pane = paneById(state, state.focusedId)
  const folder = pane ? folderOfPane(state, pane) : null
  if (pane && folder) return { projectId: pane.projectId, folder }
  const project = state.settings.projects[0]
  return project ? { projectId: project.id, folder: project.folder } : null
}

export function onFilesRequest(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function takeFilesRequest(): FilesRequest | null {
  const request = pending
  pending = null
  return request
}

/** Opens a file in the Files view (loading its editor on first use). */
export function openInFiles(target: FilesTarget, path: string, options: { pin?: boolean; line?: number } = {}): void {
  pending = { ...target, path, pin: options.pin === true, line: options.line }
  showView('files')
  for (const listener of listeners) listener()
}

export const promptReference = (path: string, range?: LineRange): string =>
  `@${path}${range ? `#L${range.start}${range.end > range.start ? `-${range.end}` : ''}` : ''} `

/** Types `@path` (and `#Lx-y` for a selection) into the focused session and shows it; says so when there is none. */
export function addToPrompt(path: string, range?: LineRange): boolean {
  const state = store.state
  const paneId = state.focusedId ?? state.panes[0]?.id ?? null
  const view = paneId ? paneTerminal(paneId) : undefined
  if (!paneId || !view) {
    toast('Open a session to add files to its prompt', 'info')
    return false
  }
  focusPane(paneId)
  view.focus()
  view.insertText(promptReference(path, range))
  return true
}

export function openInVsCode(folder: string, path: string, line?: number): void {
  void api.openFileInVsCode(folder, path, line)
}
