import { lstatSync, mkdirSync, readdirSync, rmdirSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Each test run gets a private temp folder (named dwrun-*, not dawsha*, so an older cleaner never touches it) and points TEMP, TMP and TMPDIR at it, so everything the run (and the apps
 * it launches) creates lands inside. At the end the run removes only that folder. Earlier runs removed every
 * `dawsha*` folder created since they began, which deleted the folders of other runs going on at the same time.
 * Set DAWSHA_KEEP_TEMP=1 to keep the folder for debugging.
 */
export function startPrivateTemp(label: string, base = tmpdir()): string {
  const dir = join(base, `dwrun-${label}-${process.pid}-${Date.now().toString(36)}`)
  mkdirSync(dir, { recursive: true })
  for (const name of ['TEMP', 'TMP', 'TMPDIR']) process.env[name] = dir
  return dir
}

export function removePrivateTemp(dir: string): void {
  if (process.env.DAWSHA_KEEP_TEMP === '1') return
  removeTree(dir)
}

/**
 * Removes a folder without ever following a link out of it: symbolic links and Windows junctions are removed as
 * links (their targets are left alone), then the folder. A file still held by a quitting app is left behind.
 */
export function removeTree(path: string): void {
  let info
  try {
    info = lstatSync(path)
  } catch {
    return
  }
  if (info.isSymbolicLink()) return unlinkQuietly(path, true)
  if (!info.isDirectory()) return unlinkQuietly(path, false)
  let names: string[] = []
  try {
    names = readdirSync(path)
  } catch {
    // An unreadable folder (a junction that lstat did not report as a link) is removed as a link only.
    return unlinkQuietly(path, true)
  }
  for (const name of names) removeTree(join(path, name))
  try {
    rmdirSync(path)
  } catch {
    // A junction reports as a directory on some Node versions; rmdir removes the link itself, never its target.
    try { rmSync(path, { force: true, maxRetries: 3, retryDelay: 200 }) } catch { /* held by a process */ }
  }
}

function unlinkQuietly(path: string, link: boolean): void {
  try {
    if (link) {
      try { unlinkSync(path) } catch { rmdirSync(path) }
    } else {
      unlinkSync(path)
    }
  } catch {
    // Held by a process: left for the next cleanup.
  }
}
