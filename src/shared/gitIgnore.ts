/** A folder of new files git has never seen: nothing tracked, nothing staged inside it. */
export interface UntrackedFolder {
  /** Relative to the repository root, with a trailing slash: `downloads/`. */
  path: string
  files: number
  bytes: number
  /** The count or size stopped at a limit, so both are lower bounds. */
  capped: boolean
}

export type UntrackedFoldersResult = { ok: true; folders: UntrackedFolder[] } | { ok: false; error: string }

export interface IgnoreAddRequest {
  folder: string
  /** The folder to ignore, relative to the repository root: `downloads/`. */
  path: string
}

export type IgnoreAddResult = { ok: true; entry: string; added: boolean } | { ok: false; error: string }

export const MB = 1024 * 1024
/** A folder of new files folds into one row from this size or file count up. */
export const FOLD_MIN_BYTES = 5 * MB
export const FOLD_MIN_FILES = 25
/** The size is shown as a warning from here. */
export const HEAVY_BYTES = 100 * MB
export const MAX_IGNORE_PATH_CHARS = 1024

export function shouldFoldFolder(folder: UntrackedFolder): boolean {
  return folder.capped || folder.bytes >= FOLD_MIN_BYTES || folder.files >= FOLD_MIN_FILES
}

export function isHeavyFolder(folder: UntrackedFolder): boolean {
  return folder.bytes >= HEAVY_BYTES
}

export function folderFilesText(files: number, capped: boolean): string {
  return `${files}${capped ? '+' : ''} new ${files === 1 && !capped ? 'file' : 'files'}`
}

export function ignoredToast(path: string): string {
  return `${path} added to .gitignore`
}

export type IgnorePathResult = { ok: true; path: string } | { ok: false; error: string }

/** Validates a repository-relative folder path: no absolute paths, drive letters, `..`, backslashes, control characters or empty parts. */
export function checkIgnorePath(value: unknown): IgnorePathResult {
  if (typeof value !== 'string' || value.trim() === '') return { ok: false, error: 'Choose a folder to ignore.' }
  if (value.length > MAX_IGNORE_PATH_CHARS) return { ok: false, error: 'That path is too long.' }
  if (/[\x00-\x1f\x7f]/.test(value)) return { ok: false, error: 'That path has characters a .gitignore line cannot hold.' }
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\\')) {
    return { ok: false, error: 'Use a path inside the repository, like downloads/.' }
  }
  const parts = value.replace(/\/+$/, '').split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    return { ok: false, error: 'The path must stay inside the repository.' }
  }
  if (parts[0] === '.git') return { ok: false, error: 'The .git folder cannot be ignored.' }
  return { ok: true, path: parts.join('/') }
}

function escapePart(part: string): string {
  const special = part.replace(/[\\*?[\]]/g, '\\$&')
  const lead = special.startsWith('#') || special.startsWith('!') ? `\\${special}` : special
  return lead.replace(/ +$/, (spaces) => '\\ '.repeat(spaces.length))
}

/** The one .gitignore line for a folder: anchored to the repository root, matching directories only: `/downloads/`. */
export function ignoreEntry(path: string): string {
  return `/${path.split('/').map(escapePart).join('/')}/`
}

const normalized = (line: string): string => line.replace(/\r$/, '').replace(/^\//, '').replace(/\/$/, '')

/** The .gitignore text with the entry appended, keeping the file's line endings. `null` when an equivalent line is already there. */
export function appendIgnoreEntry(existing: string, entry: string): string | null {
  const wanted = normalized(entry)
  if (existing.split('\n').some((line) => normalized(line) === wanted)) return null
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const lead = existing === '' || existing.endsWith('\n') ? '' : eol
  return `${existing}${lead}${entry}${eol}`
}

export type FoldedRows<T> = Array<{ kind: 'file'; row: T } | { kind: 'folder'; folder: UntrackedFolder; rows: T[] }>

/**
 * Collapses new (letter `U`) files that sit in a big untracked folder into one entry per folder, placed where the folder's first file was.
 * Staged-added files have letter `A`, so they stay as they are: only files git has never seen are ever folded.
 */
export function foldRows<T extends { path: string; letter: string }>(rows: readonly T[], folders: readonly UntrackedFolder[]): FoldedRows<T> {
  const folded = folders.filter(shouldFoldFolder)
  const out: FoldedRows<T> = []
  const placed = new Map<string, T[]>()
  for (const row of rows) {
    const folder = row.letter === 'U' ? folded.find((candidate) => row.path.startsWith(candidate.path)) : undefined
    if (!folder) {
      out.push({ kind: 'file', row })
      continue
    }
    const members = placed.get(folder.path)
    if (members) members.push(row)
    else {
      const first = [row]
      placed.set(folder.path, first)
      out.push({ kind: 'folder', folder, rows: first })
    }
  }
  return out
}
