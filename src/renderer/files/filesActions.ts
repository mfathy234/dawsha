import { api } from '../api'
import { focusPane, showView } from '../actions'
import { confirmDialog } from '../components/dialogs'
import { toast } from '../components/toast'
import { toProjectPath } from '../../shared/projectPaths'
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
  review?: boolean
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

/** Shows a project folder in the Files view without opening a file. */
export function openFolderInFiles(target: FilesTarget): void {
  openInFiles(target, '')
}

/** Opens Files on a checkout in Review mode, listing what changed there. */
export function openReviewInFiles(target: FilesTarget): void {
  pending = { ...target, path: '', pin: false, review: true }
  showView('files')
  for (const listener of listeners) listener()
}

/** Opens a file in the Files view (loading its editor on first use). */
export function openInFiles(target: FilesTarget, path: string, options: { pin?: boolean; line?: number } = {}): void {
  pending = { ...target, path, pin: options.pin === true, line: options.line }
  showView('files')
  for (const listener of listeners) listener()
}

export const promptReference = (path: string, range?: LineRange): string =>
  `@${path}${range ? `#L${range.start}${range.end > range.start ? `-${range.end}` : ''}` : ''} `

/** Inserts text into a session's prompt without submitting it, and puts that pane in front. False (with a note) when it is gone. */
export function insertIntoSession(paneId: string, text: string): boolean {
  const view = paneTerminal(paneId)
  if (!view || !paneById(store.state, paneId)) {
    toast('That session is not open any more.', 'info')
    return false
  }
  focusPane(paneId)
  view.focus()
  view.insertText(text)
  return true
}

/** Types `@path` (and `#Lx-y` for a selection) into the focused session and shows it; says so when there is none. */
export function addToPrompt(path: string, range?: LineRange, prefix = ''): boolean {
  const state = store.state
  const paneId = state.focusedId ?? state.panes[0]?.id ?? null
  if (!paneId || !paneTerminal(paneId)) {
    toast('Open a session to add files to its prompt', 'info')
    return false
  }
  return insertIntoSession(paneId, promptReference(toProjectPath(prefix, path), range))
}

const searchListeners = new Set<() => void>()

/** Ctrl+Shift+F while Files is showing: the view opens its Search mode. */
export function requestFilesSearch(): void {
  for (const listener of searchListeners) listener()
}

export function onFilesSearchRequest(listener: () => void): () => void {
  searchListeners.add(listener)
  return () => searchListeners.delete(listener)
}

export type FilesCommand =
  | 'toggle-inspector' | 'toggle-explorer' | 'switch-worktree' | 'switch-branch'
  | 'definition' | 'implementation' | 'references' | 'back' | 'forward' | 'everything' | 'symbol' | 'line'

const commandListeners = new Set<(command: FilesCommand) => void>()

/** A Files shortcut or palette command (hide the inspector or explorer, switch worktree): the open view runs it. */
export function requestFilesCommand(command: FilesCommand): void {
  for (const listener of commandListeners) listener(command)
}

export function onFilesCommand(listener: (command: FilesCommand) => void): () => void {
  commandListeners.add(listener)
  return () => commandListeners.delete(listener)
}

export function openInVsCode(folder: string, path: string, line?: number): void {
  void api.openFileInVsCode(folder, path, line)
}
