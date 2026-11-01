import { execFile } from 'node:child_process'
import { platformExecutableDirs, resolveExecutable } from './executables'

export interface GhRun {
  ok: boolean
  missing: boolean
  stdout: string
  message: string
}

const QUICK_MS = 30_000
const MAX_BUFFER = 8 * 1024 * 1024
const WINDOWS_DIRS = ['C:\\Program Files\\GitHub CLI', 'C:\\Program Files (x86)\\GitHub CLI']

interface Launch {
  file: string
  prefix: string[]
  env: NodeJS.ProcessEnv
}

/** The gh program. DAWSHA_GH_COMMAND names another one, and DAWSHA_GH_SCRIPT runs a script with Electron as Node, both for tests. */
function launch(): Launch | null {
  const env = { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1', NO_COLOR: '1', GH_PAGER: '' }
  const script = process.env.DAWSHA_GH_SCRIPT
  if (script) return { file: process.execPath, prefix: [script], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }
  const file = resolveExecutable(process.env.DAWSHA_GH_COMMAND || 'gh', [...platformExecutableDirs(), ...(process.platform === 'win32' ? WINDOWS_DIRS : [])])
  return file ? { file, prefix: [], env } : null
}

/** Runs gh with an argument array and no shell. Every value in args must already be validated. */
export function runGh(cwd: string, args: readonly string[], timeout = QUICK_MS): Promise<GhRun> {
  const target = launch()
  if (!target) return Promise.resolve({ ok: false, missing: true, stdout: '', message: 'gh is not installed.' })
  return new Promise((resolveRun) => {
    execFile(target.file, [...target.prefix, ...args], { cwd, timeout, maxBuffer: MAX_BUFFER, windowsHide: true, shell: false, env: target.env }, (error, stdout, stderr) => {
      const missing = (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
      resolveRun({ ok: !error, missing, stdout: `${stdout}`, message: `${stderr}`.trim() || `${stdout}`.trim() || (error ? error.message : '') })
    })
  })
}
