import { readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Tests create many `dawsha*` folders in the temp directory (sandboxes, fake repos, profiles) and most never remove
 * them, which once grew to 20 GB. A run removes the ones it created: folders whose names start with `dawsha` and
 * that appeared after the run began. Folders from before the run, such as another run in progress, are left alone.
 * Set DAWSHA_KEEP_TEMP=1 to keep them for debugging.
 */
export function removeTempCreatedSince(startedAt: number, owns: (name: string) => boolean, dir = tmpdir()): number {
  if (process.env.DAWSHA_KEEP_TEMP === '1') return 0
  let removed = 0
  for (const name of safeList(dir)) {
    if (!name.startsWith('dawsha') || !owns(name)) continue
    const path = join(dir, name)
    try {
      const info = statSync(path)
      if (!info.isDirectory() || info.birthtimeMs < startedAt) continue
      // rmSync does not follow symbolic links or junctions inside the folder; it removes the links themselves.
      rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
      removed += 1
    } catch {
      // A folder still held by a process (a quitting app, a watcher) is left for the next run.
    }
  }
  return removed
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
