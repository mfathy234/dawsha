import { appendFile, lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appendIgnoreEntry, checkIgnorePath, ignoreEntry, type IgnoreAddRequest, type IgnoreAddResult } from '../shared/gitIgnore'
import { forgetChanges } from './git'
import { git, insideRoot, repoRoot } from './gitCommit'

const MAX_IGNORE_FILE_BYTES = 1024 * 1024
const NOT_A_REPO = 'This folder is not a git repository.'

const fail = (error: string): IgnoreAddResult => ({ ok: false, error })

async function isPlainFolder(path: string): Promise<boolean> {
  try {
    const info = await lstat(path)
    return info.isDirectory() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

async function readIgnoreFile(path: string): Promise<string | null> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.size > MAX_IGNORE_FILE_BYTES) return null
    return await readFile(path, 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? '' : null
  }
}

/** Appends one `/folder/` line to the repository's root .gitignore. Only a real folder inside the repository with nothing tracked in it is accepted. */
export async function addGitIgnore(request: IgnoreAddRequest): Promise<IgnoreAddResult> {
  const checked = checkIgnorePath(request?.path)
  if (!checked.ok) return fail(checked.error)
  const root = await repoRoot(request.folder)
  if (!root) return fail(NOT_A_REPO)
  const target = insideRoot(root, checked.path)
  if (!target || !(await isPlainFolder(target))) return fail(`${checked.path}/ is not a folder in this repository.`)
  const tracked = await git(root, ['ls-files', '-z', '--', `${checked.path}/`])
  if (!tracked.ok) return fail(tracked.message)
  if (tracked.stdout !== '') return fail(`${checked.path}/ has files git already tracks, so ignoring it would not stop them showing up.`)
  const file = join(root, '.gitignore')
  const existing = await readIgnoreFile(file)
  if (existing === null) return fail('Could not read the .gitignore in this repository.')
  const entry = ignoreEntry(checked.path)
  const next = appendIgnoreEntry(existing, entry)
  if (next === null) return { ok: true, entry, added: false }
  try {
    await appendFile(file, next.slice(existing.length), 'utf8')
  } catch (error) {
    return fail(`Could not write the .gitignore: ${(error as Error).message}`)
  }
  forgetChanges()
  return { ok: true, entry, added: true }
}
