import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shellArgs, shellCommand, type LaunchSpec } from './agentLaunch'

export interface SetupCommand {
  spec: LaunchSpec
  dispose(): void
}

/** Commands are owner-authored settings. Keep them out of shell arguments on Windows. */
export function createSetupCommand(command: string): SetupCommand {
  if (process.platform !== 'win32') {
    const file = shellCommand()
    const lines = command.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim() !== '')
    return { spec: { file, args: shellArgs(file, `set -e\n${lines.map((line) => `( ${line}\n)`).join('\n')}`) }, dispose: () => undefined }
  }
  const directory = mkdtempSync(join(tmpdir(), 'dawsha-worktree-setup-'))
  const script = join(directory, 'setup.cmd')
  // Each independent line is a stack's setup command. Do not allow a later stack to
  // conceal an earlier failure. A caret continues the current command as usual.
  const lines = command.replace(/\r\n?/g, '\n').split('\n')
  let continued = false
  const body = lines.flatMap((line) => {
    const prefix = continued ? [] : ['cd /d "%DAWSHA_WORKTREE_SETUP_ROOT%"', 'if errorlevel 1 exit /b 1']
    continued = line.trimEnd().endsWith('^')
    return [...prefix, line, ...(continued ? [] : ['if errorlevel 1 exit /b 1'])]
  })
  try {
    writeFileSync(script, ['@echo off', 'setlocal', 'set "DAWSHA_WORKTREE_SETUP_ROOT=%CD%"', ...body, 'exit /b 0', ''].join('\r\n'), 'utf8')
  } catch (error) {
    try { rmdirSync(directory) } catch { /* Preserve the original write error. */ }
    throw error
  }
  return {
    spec: { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/q', '/c', script] },
    dispose: () => {
      try { unlinkSync(script) } catch { /* The script may have already been disposed. */ }
      try { rmdirSync(directory) } catch { /* Never recursively remove a temp directory. */ }
    }
  }
}
