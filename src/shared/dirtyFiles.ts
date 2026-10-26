const LISTED = 5

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** The dialog shown when the window closes while Files tabs have unsaved edits; the files are named, never "some files". */
export function unsavedQuitCopy(paths: readonly string[]): { title: string; body: string; confirmLabel: string } {
  const names = paths.map(baseName)
  if (names.length === 1) {
    return {
      title: `Close with unsaved changes in ${names[0]}?`,
      body: `${paths[0]} has changes that are not saved. Closing Dawsha discards them.`,
      confirmLabel: `Discard changes to ${names[0]}`
    }
  }
  const shown = paths.slice(0, LISTED).join(', ')
  const more = paths.length > LISTED ? ` and ${paths.length - LISTED} more` : ''
  return {
    title: `Close with unsaved changes in ${names.length} files?`,
    body: `${shown}${more} have changes that are not saved. Closing Dawsha discards them.`,
    confirmLabel: `Discard changes to ${names.length} files`
  }
}
