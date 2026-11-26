import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { integratedShell } from '../../src/main/shellIntegration'

it('injects PowerShell hooks without disabling user profiles', () => {
  const launch = integratedShell({ file: 'pwsh.exe', args: ['-NoLogo'] }, {})
  expect(launch.args).toContain('-NoExit')
  expect(launch.args).not.toContain('-NoProfile')
  expect(integratedShell({ file: 'pwsh.exe', args: ['-NoProfile'] }, {}).args).toContain('-NoProfile')
  const script = Buffer.from(launch.args.at(-1)!, 'base64').toString('utf16le')
  expect(script).toContain('PSConsoleHostReadLine')
  expect(script).toContain('133;D;')
  expect(script).toContain('133;C')
})

it('loads user shell configuration before appending bash and zsh hooks', () => {
  const bash = integratedShell({ file: '/bin/bash', args: ['-l'] }, {})
  expect(bash.args[0]).toBe('--init-file')
  expect(readFileSync(bash.args[1], 'utf8')).toContain('PROMPT_COMMAND')
  expect(readFileSync(bash.args[1], 'utf8')).toContain('~/.bash_profile')
  const env: Record<string, string> = { ZDOTDIR: '/custom' }
  const zsh = integratedShell({ file: '/bin/zsh', args: ['-l'] }, env)
  expect(zsh.file).toBe('/bin/zsh')
  expect(zsh.args).toContain('-l')
  expect(env.DAWSHA_USER_ZDOTDIR).toBe('/custom')
  expect(readFileSync(env.ZDOTDIR + '/.zshrc', 'utf8')).toContain('add-zsh-hook preexec')
  expect(readFileSync(env.ZDOTDIR + '/.zshenv', 'utf8')).toContain('DAWSHA_USER_ZDOTDIR=$ZDOTDIR\nZDOTDIR=$DAWSHA_INJECT_ZDOTDIR')
})

it('leaves custom programs and noninteractive commands alone', () => {
  const spec = { file: 'node.exe', args: ['script.js'] }
  expect(integratedShell(spec, {})).toEqual(spec)
})
