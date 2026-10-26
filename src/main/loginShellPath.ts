import { execFile } from 'node:child_process'
import { delimiter } from 'node:path'

const MARK = '__DAWSHA_PATH__'
const TIMEOUT_MS = 4000

let cached: Promise<string[]> | null = null

/**
 * The PATH a login shell builds. A GUI app on macOS (and a desktop-launched one on Linux) does not inherit it,
 * so npm prefixes added in ~/.zshrc or ~/.profile are invisible without this. Windows has one system PATH.
 */
export function loginShellPath(platform = process.platform, shell = process.env.SHELL): Promise<string[]> {
  if (platform === 'win32' || !shell) return Promise.resolve([])
  cached ??= new Promise<string[]>((resolve) => {
    try {
      execFile(
        shell,
        ['-ilc', `printf '%s%s\\n' '${MARK}' "$PATH"`],
        { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024, env: { ...process.env, TERM: 'dumb' } },
        (error, stdout) => {
          const line = String(stdout ?? '')
            .split('\n')
            .find((entry) => entry.includes(MARK))
          if (error && !line) return resolve([])
          resolve(line ? line.slice(line.indexOf(MARK) + MARK.length).trim().split(delimiter).filter(Boolean) : [])
        }
      )
    } catch {
      resolve([])
    }
  })
  return cached
}

export const clearLoginShellPath = (): void => {
  cached = null
}
