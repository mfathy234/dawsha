import { afterEach, expect, it, vi } from 'vitest'

const spawn = vi.hoisted(() => vi.fn((_file: string, _args: unknown, _options?: unknown) => ({ on: vi.fn(), unref: vi.fn() })))
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('electron', () => ({ BrowserWindow: vi.fn(), Notification: vi.fn(), shell: { openPath: vi.fn() } }))
vi.mock('../../src/main/executables', () => ({
  resolveExecutable: () => '/usr/bin/code', platformExecutableDirs: () => ['/usr/bin']
}))

import { quickOpen } from '../../src/main/desktop'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

it('passes Linux folder names literally to VS Code without shell evaluation', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  vi.stubEnv('DAWSHA_OPEN_LOG', '')
  const folder = '/tmp/project$(touch injected) `echo bad` "quoted"'
  await quickOpen('vscode', folder)
  expect(spawn).toHaveBeenCalledWith('/usr/bin/code', ['--reuse-window', folder], expect.objectContaining({
    detached: true, stdio: 'ignore'
  }))
  expect(spawn.mock.calls[0][2]).not.toHaveProperty('shell', true)
})
