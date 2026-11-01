import type { EditFileOutcome, EditPreviewFile } from '../../shared/codeNavExtras'

export interface ConfirmCopy {
  title: string
  body: string
  confirmLabel: string
}

const MAX_LISTED = 8
const plural = (count: number, word: string): string => `${count} ${count === 1 ? word : word.endsWith('ch') ? `${word}es` : `${word}s`}`
const placeCount = (files: readonly EditPreviewFile[]): number => files.reduce((sum, file) => sum + file.matches, 0)

export const placesIn = (files: readonly EditPreviewFile[]): string => `${plural(placeCount(files), 'place')} in ${plural(files.length, 'file')}`

/** Files in the preview that have unsaved edits in an editor tab: the apply refuses these, so the preview says so first. */
export const dirtyConflicts = (files: readonly EditPreviewFile[], dirty: readonly string[]): string[] => {
  const unsaved = new Set(dirty)
  return files.filter((file) => unsaved.has(file.path)).map((file) => file.path)
}

function listing(files: readonly EditPreviewFile[]): string {
  const shown = files.slice(0, MAX_LISTED).map((file) => `${file.path}  ${plural(file.matches, 'place')}`)
  const more = files.length - shown.length
  return [...shown, ...(more > 0 ? [`and ${plural(more, 'more file')}`] : [])].join('\n')
}

const quoted = (text: string): string => (text.length > 40 ? `${text.slice(0, 40)}…` : text)

export function renameCopy(oldName: string, newName: string, files: readonly EditPreviewFile[]): ConfirmCopy {
  return {
    title: `Rename ${oldName} to ${newName}?`,
    body: `${placesIn(files)} change on disk:\n${listing(files)}\nOpen tabs reload. This cannot be undone from here.`,
    confirmLabel: `Rename in ${plural(files.length, 'file')} (${plural(placeCount(files), 'place')})`
  }
}

export function replaceCopy(query: string, replacement: string, files: readonly EditPreviewFile[]): ConfirmCopy {
  return {
    title: `Replace "${quoted(query)}" with "${quoted(replacement)}" in ${plural(files.length, 'file')}?`,
    body: `${placesIn(files)} change on disk:\n${listing(files)}\nOpen tabs reload. This cannot be undone from here.`,
    confirmLabel: `Replace ${plural(placeCount(files), 'match')} in ${plural(files.length, 'file')}`
  }
}

/** What to tell the user after an apply: how many files changed, and which ones did not and why. */
export function outcomeText(outcomes: readonly EditFileOutcome[]): { text: string; changed: string[]; failed: EditFileOutcome[] } {
  const changed = outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.path)
  const failed = outcomes.filter((outcome) => !outcome.ok)
  const done = `Changed ${plural(changed.length, 'file')}`
  if (failed.length === 0) return { text: done, changed, failed }
  const why = failed.slice(0, 3).map((outcome) => `${outcome.path}: ${outcome.conflict ? 'changed on disk since the preview' : outcome.error ?? 'could not be written'}`).join('; ')
  return { text: `${done}. ${plural(failed.length, 'file')} not changed. ${why}`, changed, failed }
}
