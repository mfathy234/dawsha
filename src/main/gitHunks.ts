import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import type { HunkRequest, HunkResult } from '../shared/codeNavExtras'
import { validRelative } from './codeNav/editPreviews'
import { forgetChanges } from './git'
import { git, REPO_BUSY, repoRoot, tryLockRepo, unlockRepo } from './gitCommit'
import { mergeBase, resolveProjectFile } from './gitWorkspace'

type Coordinates = Pick<HunkRequest, 'oldStart' | 'oldLines' | 'newStart' | 'newLines'>
export interface DiffHunk { coordinates: Coordinates; text: string }
const MAX_PATCH = 1024 * 1024
const conflict = (error = 'This change no longer matches. Refresh Changes and try again.'): HunkResult => ({ ok: false, conflict: true, error })

export function diffHunks(diff: string): DiffHunk[] {
  const headers = [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n/gm)]
  return headers.map((match, index) => ({
    coordinates: { oldStart: Number(match[1]), oldLines: Number(match[2] ?? 1), newStart: Number(match[3]), newLines: Number(match[4] ?? 1) },
    text: diff.slice(match.index, headers[index + 1]?.index ?? diff.length)
  }))
}

function validate(raw: unknown): HunkRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as HunkRequest
  if (!validRelative(value.path) || typeof value.expectedHunk !== 'string' || value.expectedHunk.length > MAX_PATCH || !value.expectedHunk.startsWith('@@ ')) return null
  if (!Number.isFinite(value.expectedMtime) || value.expectedMtime < 0) return null
  if (![value.oldStart, value.oldLines, value.newStart, value.newLines].every(number => Number.isSafeInteger(number) && number >= 0)) return null
  return value
}

/** Only main-generated patches reach stdin; no shell, client patch headers, or git-configured diff tools. */
function apply(root: string, patch: string, args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn('git', ['apply', '-p1', '--whitespace=nowarn', ...args, '-'], { cwd: root, shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] })
    const timer = setTimeout(() => { child.kill(); resolve(false) }, 5000)
    child.once('error', () => { clearTimeout(timer); resolve(false) })
    child.once('close', code => { clearTimeout(timer); resolve(code === 0) })
    child.stdin.on('error', () => undefined)
    child.stdin.end(patch)
  })
}

async function applyMatching(folder: string, root: string, request: HunkRequest, operation: 'stage' | 'revert'): Promise<HunkResult> {
  const target = await resolveProjectFile(folder, request.path)
  if (!target.ok) return target
  const before = await stat(target.full)
  if (!before.isFile() || before.mtimeMs !== request.expectedMtime) return conflict()
  const base = await mergeBase(root)
  if (!base) return { ok: false, error: 'This repository has no base commit.' }
  const diff = await git(root, ['diff', '--src-prefix=a/', '--dst-prefix=b/', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', base, '--', target.realRel])
  if (!diff.ok || diff.stdout.length > MAX_PATCH) return { ok: false, error: 'Cannot read this change as a bounded text diff.' }
  const hunk = diffHunks(diff.stdout).find(value => Object.entries(value.coordinates).every(([key, number]) => request[key as keyof Coordinates] === number))
  if (!hunk || hunk.text !== request.expectedHunk) return conflict()
  const patch = diff.stdout.slice(0, diff.stdout.indexOf('@@ ')) + hunk.text
  const args = operation === 'stage' ? ['--cached'] : ['--reverse']
  if (!await apply(root, patch, [...args, '--check'])) return conflict('Git cannot apply this hunk to the current index or working file. Refresh Changes.')
  const checked = await resolveProjectFile(folder, request.path)
  if (!checked.ok || checked.full !== target.full || (await stat(checked.full)).mtimeMs !== request.expectedMtime) return conflict()
  return await apply(root, patch, args) ? { ok: true } : conflict()
}

export async function changeHunk(folder: string, raw: unknown, operation: 'stage' | 'revert'): Promise<HunkResult> {
  const request = validate(raw)
  if (!request) return { ok: false, error: 'Invalid hunk request.' }
  const root = await repoRoot(folder)
  if (!root) return { ok: false, error: 'This folder is not a git repository.' }
  if (!tryLockRepo(root)) return { ok: false, error: REPO_BUSY }
  try { return await applyMatching(folder, root, request, operation) }
  catch { return { ok: false, error: 'Could not apply this hunk.' } }
  finally { unlockRepo(root); forgetChanges() }
}
