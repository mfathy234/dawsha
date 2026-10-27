import type { FileRef } from '../shared/filePaths'
import { relativeInside, terminalMenu } from '../shared/fileMenus'
import { linkAction, type PointerMods } from '../shared/fileOpenMode'
import { toRepoPath } from '../shared/projectPaths'
import { api } from './api'
import { openContextMenu, type ContextEntry } from './components/contextMenu'
import { toast } from './components/toast'
import { workFolderOfPane } from './derive'
import { fileIndex } from './files/fileIndex'
import { openInFiles, openInVsCode } from './files/filesActions'
import { store } from './state'

interface LinkContext {
  folder: string
  projectId: string
  absolute: string
  /** The path below the project folder, or null when the file lies outside it. */
  relative: string | null
}

async function contextOf(termId: string, ref: FileRef, existing: (folder: string, paths: string[]) => Promise<(string | null)[]>): Promise<LinkContext | null> {
  const pane = store.state.panes.find((p) => p.tabs.some((t) => t.id === termId))
  const folder = pane ? workFolderOfPane(store.state, pane) : null
  if (!pane || !folder) return null
  const [absolute] = await existing(folder, [ref.path])
  if (!absolute) return null
  return { folder, projectId: pane.projectId, absolute, relative: relativeInside(folder, absolute) }
}

async function showInFiles(context: LinkContext, ref: FileRef, pin: boolean): Promise<void> {
  if (context.relative === null) return
  const { prefix } = await fileIndex(context.folder)
  openInFiles({ projectId: context.projectId, folder: context.folder }, toRepoPath(prefix, context.relative), { pin, line: ref.line })
}

/** Ctrl/Cmd+click on a path in a terminal: Files at the line for text files, the system viewer for pictures and web pages. */
export async function openTerminalLink(termId: string, ref: FileRef, mods: PointerMods, existing: (folder: string, paths: string[]) => Promise<(string | null)[]>): Promise<void> {
  const context = await contextOf(termId, ref, existing)
  if (!context) return
  const action = linkAction(mods, context.absolute, context.relative !== null)
  if (action === 'files') await showInFiles(context, ref, true)
  else if (action === 'default') void api.openFile(context.folder, ref)
}

export async function openTerminalLinkMenu(
  termId: string, ref: FileRef, x: number, y: number, restoreFocus: () => void,
  existing: (folder: string, paths: string[]) => Promise<(string | null)[]>
): Promise<void> {
  const context = await contextOf(termId, ref, existing)
  if (!context) return
  const inProject = context.relative !== null
  const copy = (text: string, done: string): void => void api.writeClipboard(text).then(() => toast(done, 'info'), () => toast('Could not copy to the clipboard.'))
  const run = async (id: string): Promise<void> => {
    if (id === 'open-files') await showInFiles(context, ref, false)
    else if (id === 'open-files-new-tab') await showInFiles(context, ref, true)
    else if (id === 'open-code' && context.relative !== null) {
      const { prefix } = await fileIndex(context.folder)
      openInVsCode(context.folder, toRepoPath(prefix, context.relative), ref.line)
    } else if (id === 'copy-path') copy(context.absolute, 'Path copied')
    else if (id === 'copy-relative' && context.relative !== null) copy(context.relative, 'Relative path copied')
  }
  const entries: ContextEntry[] = terminalMenu(inProject).map((entry) => (entry === 'separator' ? entry : { label: entry.label, keys: entry.keys, disabled: entry.disabled, run: () => void run(entry.id) }))
  openContextMenu({ x, y, label: 'Path actions', entries, returnFocus: restoreFocus })
}
