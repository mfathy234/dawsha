import { fileOpenKind } from './filePaths'

export interface PointerMods {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export interface KeyMods extends PointerMods {
  altKey: boolean
}

export const primaryHeld = (mods: Pick<PointerMods, 'ctrlKey' | 'metaKey'>): boolean => mods.ctrlKey || mods.metaKey

/** A click in the Files tree: a plain click previews, Ctrl/Cmd+click keeps the current tab and opens a pinned one. */
export const treeClickPins = (mods: Pick<PointerMods, 'ctrlKey' | 'metaKey'>): boolean => primaryHeld(mods)

export type QuickOpenChoice = 'open' | 'new-tab' | 'prompt' | 'code'

/** Enter opens in the preview tab, Ctrl+Enter in a new pinned tab, Alt+Enter adds to the prompt, Ctrl+Shift+Enter goes to VS Code. */
export function quickOpenChoice(mods: KeyMods): QuickOpenChoice {
  if (mods.altKey) return 'prompt'
  if (primaryHeld(mods)) return mods.shiftKey ? 'code' : 'new-tab'
  return 'open'
}

export type LinkAction = 'files' | 'default' | null

/**
 * What a click on a file path in a terminal does. Ctrl/Cmd+click opens a text file in Files, in a new tab at the line;
 * pictures and web pages still go to the system viewer. Ctrl+Shift+click always chooses Files. A path outside the
 * project cannot be shown in Files, so it keeps opening with the system.
 */
export function linkAction(mods: PointerMods, path: string, inProject: boolean): LinkAction {
  if (!primaryHeld(mods)) return null
  if (!inProject) return 'default'
  if (mods.shiftKey) return 'files'
  return fileOpenKind(path) === 'default' ? 'files' : 'default'
}
