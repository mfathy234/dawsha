import { toProjectPath } from './projectPaths'

export type FileActionId =
  | 'open' | 'open-new-tab' | 'toggle' | 'add-prompt' | 'copy-path' | 'copy-relative' | 'open-code' | 'reveal' | 'show-changes'
  | 'close' | 'close-others' | 'close-right' | 'open-files' | 'open-files-new-tab'

export interface FileMenuItem {
  id: FileActionId
  label: string
  keys?: string
  disabled?: boolean
}

export type FileMenuEntry = FileMenuItem | 'separator'

const item = (id: FileActionId, label: string, keys?: string, disabled = false): FileMenuItem => ({ id, label, ...(keys ? { keys } : {}), ...(disabled ? { disabled } : {}) })

export function treeMenu(kind: 'file' | 'folder', open = false): FileMenuEntry[] {
  if (kind === 'folder') {
    return [
      item('toggle', open ? 'Collapse' : 'Expand', 'Enter'),
      'separator',
      item('copy-path', 'Copy path', 'Shift+Alt+C'),
      item('copy-relative', 'Copy relative path', 'Ctrl+Shift+Alt+C'),
      'separator',
      item('reveal', 'Reveal in File Explorer', 'Shift+Alt+R')
    ]
  }
  return [
    item('open', 'Open', 'Enter'),
    item('open-new-tab', 'Open in new tab', 'Ctrl+click'),
    item('add-prompt', 'Add to prompt', 'Alt+Enter'),
    'separator',
    item('copy-path', 'Copy path', 'Shift+Alt+C'),
    item('copy-relative', 'Copy relative path', 'Ctrl+Shift+Alt+C'),
    'separator',
    item('open-code', 'Open in VS Code', 'Ctrl+Enter'),
    item('reveal', 'Reveal in File Explorer', 'Shift+Alt+R'),
    item('show-changes', 'Show changes')
  ]
}

export function tabMenu(index: number, count: number): FileMenuEntry[] {
  return [
    item('close', 'Close', 'Ctrl+W'),
    item('close-others', 'Close others', undefined, count < 2),
    item('close-right', 'Close to the right', undefined, index >= count - 1),
    'separator',
    item('copy-path', 'Copy path'),
    item('copy-relative', 'Copy relative path'),
    'separator',
    item('reveal', 'Reveal in File Explorer'),
    item('open-code', 'Open in VS Code')
  ]
}

/** A file path in a terminal. Outside the project nothing can open it in Files or VS Code, and it has no relative path. */
export function terminalMenu(inProject: boolean): FileMenuEntry[] {
  return [
    item('open-files', 'Open in Files', undefined, !inProject),
    item('open-files-new-tab', 'Open in Files, new tab', 'Ctrl+click', !inProject),
    item('open-code', 'Open in VS Code', undefined, !inProject),
    'separator',
    item('copy-path', 'Copy path'),
    item('copy-relative', 'Copy relative path', undefined, !inProject)
  ]
}

interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** The keys the tree answers while a row has the cursor; null for anything else. */
export function treeShortcut(event: KeyLike): FileActionId | null {
  const primary = event.ctrlKey || event.metaKey
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (event.altKey && !primary && !event.shiftKey && key === 'Enter') return 'add-prompt'
  if (primary && !event.altKey && !event.shiftKey && key === 'Enter') return 'open-code'
  if (event.altKey && event.shiftKey && !primary && key === 'c') return 'copy-path'
  if (event.altKey && event.shiftKey && primary && key === 'c') return 'copy-relative'
  if (event.altKey && event.shiftKey && !primary && key === 'r') return 'reveal'
  return null
}

const separatorOf = (folder: string): string => (folder.includes('\\') && !folder.includes('/') ? '\\' : '/')

/** The full path of a project-relative path, joined with the separator the folder itself uses. */
export function absolutePath(folder: string, projectPath: string): string {
  const sep = separatorOf(folder)
  const trimmed = folder.replace(/[\\/]+$/, '')
  return `${trimmed}${sep}${projectPath.split('/').join(sep)}`
}

const slashed = (text: string): string => text.replace(/\\/g, '/').replace(/\/+$/, '')

/** The path below `folder` with forward slashes, or null when `absolute` is the folder itself or lies outside it. */
export function relativeInside(folder: string, absolute: string, caseInsensitive = /^[A-Za-z]:|^\\\\/.test(folder)): string | null {
  const base = slashed(folder)
  const full = slashed(absolute)
  const same = (a: string, b: string): boolean => (caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b)
  if (full.length <= base.length + 1 || !same(full.slice(0, base.length), base) || full[base.length] !== '/') return null
  return full.slice(base.length + 1)
}

export interface PathForms {
  absolute: string
  relative: string
}

/** Both copy forms of a Files path (repo-relative): the full path, and the path as the agent sees it from the project folder. */
export function pathForms(folder: string, prefix: string, repoPath: string): PathForms {
  const relative = toProjectPath(prefix, repoPath)
  return { absolute: absolutePath(folder, relative), relative }
}
