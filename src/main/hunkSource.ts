import { lstat, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { readProjectFile, resolveProjectFile } from './gitWorkspace'
import { containsProjectPath } from './projectContainment'

export interface HunkTarget { full: string; path: string; absent: boolean }

async function missingPath(scope: string, lexical: string): Promise<string | null> {
  let directory = dirname(lexical)
  const suffix = [basename(lexical)]
  for (;;) {
    const info = await lstat(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
    if (info) {
      const actual = await realpath(directory).catch(() => null)
      return actual && containsProjectPath(scope, actual) ? join(actual, ...suffix) : null
    }
    const parent = dirname(directory)
    if (parent === directory) return null
    suffix.unshift(basename(directory))
    directory = parent
  }
}

export async function hunkTarget(folder: string, path: string): Promise<HunkTarget | null> {
  const target = await resolveProjectFile(folder, path)
  if (target.ok) return { full: target.full, path: target.realRel, absent: false }
  if (!target.missing) return null
  const scope = await realpath(folder)
  const full = await missingPath(scope, join(target.missing.root, path))
  if (!full) return null
  const info = await lstat(full).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
  return info ? null : { full, path, absent: true }
}

export async function matchesMtime(folder: string, path: string, target: HunkTarget, expectedMtime: number): Promise<boolean> {
  const current = await hunkTarget(folder, path)
  if (!current || current.full !== target.full || current.absent !== target.absent) return false
  if (current.absent) return expectedMtime === 0
  const info = await stat(current.full)
  return info.isFile() && info.mtimeMs === expectedMtime
}

export async function addedFileDiff(folder: string, path: string): Promise<string | null> {
  const read = await readProjectFile(folder, path)
  if (!read.ok || read.text === null || read.text === '') return null
  const lines = read.text.split('\n')
  const finalNewline = lines[lines.length - 1] === ''
  if (finalNewline) lines.pop()
  const a = JSON.stringify(`a/${path}`)
  const b = JSON.stringify(`b/${path}`)
  const range = lines.length === 1 ? '1' : `1,${lines.length}`
  return `diff --git ${a} ${b}\nnew file mode 100644\n--- /dev/null\n+++ ${b}\n@@ -0,0 +${range} @@\n${lines.map(line => `+${line}\n`).join('')}${finalNewline ? '' : '\\ No newline at end of file\n'}`
}
