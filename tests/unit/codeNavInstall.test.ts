import { expect, it } from 'vitest'
import { CsharpServers } from '../../src/main/codeNav/csharp'

it('only installs on request with a dotnet SDK, coalesces clicks and reports failures', async () => {
  const calls: string[][] = []
  const processes = {
    spawn: () => { throw new Error('No server should start during installation.') },
    run: async (_command: string, args: string[]) => {
      calls.push(args)
      return args[0] === '--list-sdks' ? { ok: true, stdout: '10.0.100 [sdk]', error: '' } : { ok: false, stdout: '', error: 'feed unavailable' }
    }
  }
  const servers = new CsharpServers(processes, name => name === 'dotnet' ? '/dotnet' : null)
  expect(await servers.canInstall()).toBe(true)
  expect(calls).toEqual([['--list-sdks']])
  const results = await Promise.all([servers.install(), servers.install()])
  expect(results).toEqual([{ ok: false, error: 'Could not install csharp-ls: feed unavailable' }, { ok: false, error: 'Could not install csharp-ls: feed unavailable' }])
  expect(calls).toEqual([['--list-sdks'], ['tool', 'install', '-g', 'csharp-ls']])
})

it('does not offer an install for a runtime-only dotnet installation', async () => {
  const servers = new CsharpServers({
    spawn: () => { throw new Error('No server should start.') },
    run: async () => ({ ok: true, stdout: '', error: '' })
  }, () => '/dotnet')
  expect(await servers.canInstall()).toBe(false)
  expect(await servers.install()).toMatchObject({ ok: false, error: expect.stringContaining('SDK') })
})

it('does not execute commands when dotnet is missing', async () => {
  const servers = new CsharpServers({
    spawn: () => { throw new Error('No server should start.') },
    run: async () => { throw new Error('No dotnet executable exists.') }
  }, () => null)
  expect(await servers.canInstall()).toBe(false)
})
