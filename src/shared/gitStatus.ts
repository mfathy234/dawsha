export interface GitFileEntry {
  path: string
  origPath: string | null
  index: string
  worktree: string
  untracked: boolean
  conflicted: boolean
  added: number | null
  removed: number | null
}

export interface GitStatusInfo {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFileEntry[]
}

export interface RepoStatus extends GitStatusInfo {
  root: string
}

export type RepoStatusResult = { ok: true; status: RepoStatus } | { ok: false; error: string }

export type GitCommitResult = { ok: true; hash: string; pushed: boolean } | { ok: false; error: string; committed?: string }

export type GitDiffResult = { ok: true; text: string } | { ok: false; error: string }

// The repo as it was when a session started: a commit holding the tracked files' working-tree state
// (from `git stash create`, or HEAD when the tree was clean) and the untracked files that existed then.
export interface SessionBaseline {
  ref: string | null
  at: number
  untracked: string[]
}

export const MAX_BASELINE_UNTRACKED = 2_000

export function sanitizeBaseline(value: unknown): SessionBaseline | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const ref = typeof raw.ref === 'string' && /^[0-9a-f]{7,64}$/.test(raw.ref) ? raw.ref : null
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : null
  const untracked = Array.isArray(raw.untracked)
    ? raw.untracked.filter((item): item is string => typeof item === 'string').slice(0, MAX_BASELINE_UNTRACKED)
    : []
  return at === null ? null : { ref, at, untracked }
}

export type SessionBaselineResult = { ok: true; baseline: SessionBaseline } | { ok: false; error: string }

export type SessionStatusResult =
  | { ok: true; status: RepoStatus; since: number; fellBack: boolean }
  | { ok: false; error: string }

export type ProjectFilesResult =
  | { ok: true; files: string[]; truncated: boolean; repo: boolean; prefix: string }
  | { ok: false; error: string }

export type ProjectFileResult =
  | { ok: true; text: string; size: number; mtimeMs: number }
  | { ok: true; text: null; size: number; reason: 'binary' | 'large' | 'encoding'; mtimeMs: number }
  | { ok: false; error: string }

export type ProjectFileWriteResult =
  | { ok: true; mtimeMs: number }
  | { ok: false; conflict: true; error: string }
  | { ok: false; conflict?: false; error: string }

export type FileAgainstBaseResult =
  | { ok: true; base: string | null; text: string; reason?: 'large' | 'norepo'; deleted?: true }
  | { ok: false; error: string }

export interface CommitRequest {
  folder: string
  paths: string[]
  message: string
  push: boolean
}

export interface DiscardRequest {
  folder: string
  paths: string[]
}

export interface NumstatEntry {
  path: string
  added: number | null
  removed: number | null
}

const ACTIVE_STATES = 'MTADRC'

function emptyEntry(path: string): GitFileEntry {
  return { path, origPath: null, index: '.', worktree: '.', untracked: false, conflicted: false, added: null, removed: null }
}

function applyHeader(info: GitStatusInfo, line: string): void {
  const [, key, ...rest] = line.split(' ')
  const value = rest.join(' ')
  if (key === 'branch.head') info.branch = value === '(detached)' ? null : value
  else if (key === 'branch.upstream') info.upstream = value
  else if (key === 'branch.ab') {
    const match = /^\+(\d+) -(\d+)$/.exec(value)
    if (match) {
      info.ahead = Number(match[1])
      info.behind = Number(match[2])
    }
  }
}

function afterFields(record: string, fields: number): string {
  let at = 0
  for (let i = 0; i < fields; i += 1) {
    const next = record.indexOf(' ', at)
    if (next < 0) return ''
    at = next + 1
  }
  return record.slice(at)
}

export function parseStatusV2(text: string): GitStatusInfo {
  const info: GitStatusInfo = { branch: null, upstream: null, ahead: 0, behind: 0, files: [] }
  const records = text.split('\0')
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (record === '') continue
    const kind = record[0]
    if (kind === '#') applyHeader(info, record)
    else if (kind === '?') info.files.push({ ...emptyEntry(record.slice(2)), untracked: true, worktree: '?', index: '?' })
    else if (kind === '1') {
      const entry = emptyEntry(afterFields(record, 8))
      info.files.push({ ...entry, index: record[2], worktree: record[3] })
    } else if (kind === '2') {
      const entry = emptyEntry(afterFields(record, 9))
      const origPath = records[i + 1] ?? null
      i += 1
      info.files.push({ ...entry, origPath, index: record[2], worktree: record[3] })
    } else if (kind === 'u') {
      const entry = emptyEntry(afterFields(record, 10))
      info.files.push({ ...entry, index: record[2], worktree: record[3], conflicted: true })
    }
  }
  return info
}

export function parseNumstatZ(text: string): NumstatEntry[] {
  const entries: NumstatEntry[] = []
  const records = text.split('\0')
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (record === '') continue
    const first = record.indexOf('\t')
    const second = first < 0 ? -1 : record.indexOf('\t', first + 1)
    if (second < 0) continue
    const count = (raw: string): number | null => (/^\d+$/.test(raw) ? Number(raw) : null)
    const added = count(record.slice(0, first))
    const removed = count(record.slice(first + 1, second))
    let path = record.slice(second + 1)
    if (path === '') {
      path = records[i + 2] ?? ''
      i += 2
    }
    if (path) entries.push({ path, added, removed })
  }
  return entries
}

export function withCounts(files: GitFileEntry[], counts: NumstatEntry[]): GitFileEntry[] {
  const byPath = new Map(counts.map((entry) => [entry.path, entry]))
  return files.map((file) => {
    const found = byPath.get(file.path)
    return found ? { ...file, added: found.added, removed: found.removed } : file
  })
}

export function statusLetter(file: GitFileEntry): string {
  if (file.untracked) return 'U'
  if (file.conflicted) return '!'
  const pick = (code: string): string => (ACTIVE_STATES.includes(code) ? code : '')
  return pick(file.index) || pick(file.worktree) || 'M'
}

export function isStaged(file: GitFileEntry): boolean {
  return !file.untracked && file.index !== '.' && file.index !== '?'
}

export function isUnstaged(file: GitFileEntry): boolean {
  return !file.untracked && file.worktree !== '.' && file.worktree !== '?'
}

export type PathCheck = { ok: true; paths: string[] } | { ok: false; error: string }

export function validateRepoPaths(paths: unknown): PathCheck {
  if (!Array.isArray(paths) || paths.length === 0) return { ok: false, error: 'No files selected.' }
  const clean: string[] = []
  for (const raw of paths) {
    if (typeof raw !== 'string' || raw === '' || raw.includes('\0')) return { ok: false, error: 'Invalid file path.' }
    if (/^([a-zA-Z]:|[\\/])/.test(raw)) return { ok: false, error: `Path is outside the repository: ${raw}` }
    const segments = raw.split(/[\\/]/)
    if (segments.some((segment) => segment === '..')) return { ok: false, error: `Path is outside the repository: ${raw}` }
    clean.push(raw.replace(/\\/g, '/'))
  }
  return { ok: true, paths: [...new Set(clean)] }
}

export function expandRenames(files: GitFileEntry[], paths: string[]): string[] {
  const wanted = new Set(paths)
  const all = new Set(paths)
  for (const file of files) if (wanted.has(file.path) && file.origPath) all.add(file.origPath)
  return [...all]
}

export function firstLine(message: string): string {
  return message.split(/\r?\n/, 1)[0] ?? ''
}

export const SUBJECT_HINT_LENGTH = 72

export function discardMessage(paths: string[], untracked: string[]): { title: string; body: string; label: string } {
  const label = paths.length === 1 ? `Discard ${paths[0]}` : `Discard ${paths.length} files`
  const list = paths.map((path) => `  ${path}`).join('\n')
  const tail =
    untracked.length === 0
      ? 'Your changes in these files will be lost.'
      : `Untracked files will be deleted from disk: ${untracked.join(', ')}. Tracked files go back to the last commit.`
  return { title: label, body: `${paths.length === 1 ? 'File' : 'Files'}:\n${list}\n${tail}`, label }
}
