import type { SearchRequest } from '../../shared/fileSearch'
import type { EditResult } from '../../shared/codeNavExtras'
import { toProjectPath, toRepoPath } from '../../shared/projectPaths'
import { api } from '../api'
import { confirmDialog, promptDialog } from '../components/dialogs'
import { toast } from '../components/toast'
import { showEditPreview } from './editPreviewDialog'
import { outcomeText, renameCopy, replaceCopy, type ConfirmCopy } from './editPlan'
import type { ToolsHost } from './toolsHost'

type Preview = Extract<EditResult, { ok: true; action: 'preview' }>

const NAME = /^@?[$_\p{L}][$_\p{L}\p{N}]*$/u
const NEEDS_SERVER = 'Rename needs a language server, so it can be exact. Start or install one for this file type, then try again. A name search could rename the wrong things.'

const failure = (error: unknown): EditResult => ({ ok: false, error: error instanceof Error ? error.message : 'The request failed.' })

/** Preview, then the confirmation, then the write. Nothing reaches the disk unless the user confirms the exact files and counts. */
async function review(host: ToolsHost, preview: Preview, copy: ConfirmCopy, title: string, apply: (previewId: string, dirty: string[]) => Promise<EditResult>): Promise<void> {
  const prefix = host.prefix()
  const dirty = host.dirtyPaths().map((path) => toProjectPath(prefix, path))
  const source = preview.engine === 'search' ? 'Found by text search' : preview.engine === 'name' ? 'Found by name, so check each place' : 'Exact, from the language service'
  const go = await showEditPreview({
    title, source, files: preview.files, truncated: preview.truncated, dirty, applyLabel: 'Apply…',
    text: (path) => host.text(toRepoPath(prefix, path))
  })
  if (!go) return
  const confirmed = await confirmDialog(copy)
  if (!confirmed) return
  const result = await apply(preview.previewId, dirty).catch(failure)
  if (!result.ok) return host.warn(result.error)
  if (result.action !== 'apply') return
  const outcome = outcomeText(result.files)
  toast(outcome.text, outcome.failed.length > 0 ? 'error' : 'info')
  host.changedOnDisk(outcome.changed.map((path) => toRepoPath(prefix, path)))
}

/** F2: asks for the new name, previews every place it changes, and applies only after a confirmation. */
export async function renameSymbol(host: ToolsHost): Promise<void> {
  const doc = host.active()
  const editor = doc?.editor
  const folder = host.folder()
  if (!doc || !editor || !folder) return
  const found = editor.identifierAt(editor.cursorPos())
  if (!found) return host.say('Put the cursor on a name first, then press F2.')
  if (doc.dirty) return host.warn('Save this file first, then rename.')
  const newName = await promptDialog({
    title: `Rename ${found.name}`, label: 'New name', initial: found.name, confirmLabel: 'Preview',
    hint: 'You will see every change before anything is written.',
    validate: (value) => (value === found.name ? 'Type a different name.' : NAME.test(value) ? null : 'Use letters, digits and underscores, starting with a letter.')
  })
  if (newName === null) return
  const cursor = editor.cursor()
  const request = { action: 'preview' as const, path: toProjectPath(host.prefix(), doc.path), symbol: found.name, line: cursor.line, column: cursor.col, newName }
  const result = await api.renameSymbol(folder, request).catch(failure)
  if (!result.ok) return host.warn(result.needsLanguageServer ? NEEDS_SERVER : result.error)
  if (result.action !== 'preview') return
  if (result.files.length === 0) return host.say(`Nothing to rename for ${found.name}.`)
  await review(host, result, renameCopy(found.name, newName, result.files), `Rename ${found.name} to ${newName}`, (previewId, dirtyPaths) => api.renameSymbol(folder, { action: 'apply', previewId, dirtyPaths }))
}

/** Replace across files: previews every match with its new text, then confirms the files and counts. */
export async function replaceInFiles(host: ToolsHost, search: SearchRequest, replacement: string): Promise<void> {
  const folder = host.folder()
  if (!folder || search.query.trim() === '') return
  const result = await api.replaceInFiles(folder, { ...search, action: 'preview', replacement }).catch(failure)
  if (!result.ok) return host.warn(result.error)
  if (result.action !== 'preview') return
  if (result.files.length === 0) return host.say('No matches to replace.')
  await review(host, result, replaceCopy(search.query, replacement, result.files), `Replace ${search.query} with ${replacement}`, (previewId, dirtyPaths) => api.replaceInFiles(folder, { action: 'apply', previewId, dirtyPaths }))
}
