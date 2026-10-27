import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverRunCommands } from '../../src/main/runCommands/discovery'
import { sanitizeRunOverrides } from '../../src/shared/runCommands'

const roots: string[] = []
async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dawsha-runs-'))
  roots.push(root)
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), text)
  }
  return root
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})
describe('read-only run discovery', () => {
  it('uses one canonical checkout root when an alias selects a nested config', async () => {
    const outer = await fixture({
      'checkout/package.json': '{"packageManager":"pnpm@9.0.0"}',
      'checkout/apps/web/package.json': '{"scripts":{"dev":"web dev"}}'
    })
    const checkout = join(outer, 'checkout')
    const alias = join(outer, 'checkout-alias')
    await symlink(checkout, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const result = await discoverRunCommands(alias, { config: 'apps/web/package.json' })
    expect(result.commands).toMatchObject([
      { source: 'apps/web/package.json', cwd: 'apps/web', executable: 'pnpm' }
    ])
    expect(result.warnings).toEqual([])
  })

  it('offers solution build/test and distinct runnable projects, excluding libraries/tests/expressions', async () => {
    const root = await fixture({
      'App.sln': '',
      'web/Web.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"/>',
      'lib/Lib.csproj': '<Project/>',
      'test/Test.csproj':
        '<Project><OutputType>Exe</OutputType><IsTestProject>true</IsTestProject></Project>',
      'app/App.csproj': '<Project><OutputType>Exe</OutputType></Project>',
      'dynamic/Other.csproj':
        '<Project><OutputType>$(Kind)</OutputType></Project>'
    })
    const result = await discoverRunCommands(root)
    expect(
      result.commands.filter((c) => c.args?.[0] === 'run').map((c) => c.source)
    ).toEqual(['app/App.csproj', 'web/Web.csproj'])
    expect(
      result.commands
        .filter((c) => c.source === 'App.sln')
        .map((c) => c.args?.[0])
    ).toEqual(['build', 'test'])
    expect(result.warnings.join(' ')).toMatch(/complex|unresolved/i)
  })
  it('handles commented launch profiles without copying their environment secrets', async () => {
    const root = await fixture({
      'App.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"/>',
      'Properties/launchSettings.json':
        '{ // comment\n "profiles": {"Dev": {"commandName":"Project", "environmentVariables":{"TOKEN":"secret-value"}},"IIS":{"commandName":"IISExpress"},},}'
    })
    const result = await discoverRunCommands(root)
    expect(result.commands.some((c) => c.args?.includes('Dev'))).toBe(true)
    expect(JSON.stringify(result)).not.toContain('secret-value')
    expect(result.warnings.join(' ')).toContain('IIS')
  })
  it('makes Watch noninteractive and forwards launch flags after the argument separator', async () => {
    const root = await fixture({
      'App.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"/>',
      'Properties/launchSettings.json':
        '{"profiles":{"Dev":{"commandName":"Project"}}}'
    })
    const result = await discoverRunCommands(root)
    expect(
      result.commands.find((command) => command.args?.[0] === 'watch')?.args
    ).toEqual([
      'watch',
      '--non-interactive',
      '--project',
      'App.csproj',
      'run',
      '--',
      '--launch-profile',
      'Dev'
    ])
  })
  it.each(['pnpm', 'yarn'] as const)(
    'discovers source packages and apps with inherited %s and preserves root scripts',
    async (manager) => {
      const root = await fixture({
        'package.json': JSON.stringify({
          packageManager: `${manager}@9.0.0`,
          scripts: { build: 'workspace build' }
        }),
        [manager === 'pnpm' ? 'pnpm-lock.yaml' : 'yarn.lock']: '',
        'packages/ui/package.json': '{"scripts":{"dev":"ui dev"}}',
        'apps/web/package.json': '{"scripts":{"start":"web start"}}',
        'packages/ui/node_modules/dependency/package.json':
          '{"scripts":{"dev":"dependency"}}',
        'packages/ui/dist/package.json': '{"scripts":{"dev":"generated"}}'
      })
      const result = await discoverRunCommands(root)
      expect(
        result.commands.map((command) => [
          command.source,
          command.executable,
          command.cwd
        ])
      ).toEqual([
        ['apps/web/package.json', manager, 'apps/web'],
        ['package.json', manager, '.'],
        ['packages/ui/package.json', manager, 'packages/ui']
      ])
      expect(result.warnings).toEqual([])
      const explicit = await discoverRunCommands(root, {
        config: 'packages/ui/package.json'
      })
      expect(explicit.commands[0].executable).toBe(manager)
    }
  )
  it('inherits lockfile-only managers and the nearest separately managed subtree', async () => {
    const root = await fixture({
      'pnpm-lock.yaml': '',
      'apps/web/package.json': '{"scripts":{"dev":"web dev"}}',
      'packages/tools/package.json': '{"packageManager":"yarn@4.0.0"}',
      'packages/tools/yarn.lock': '',
      'packages/tools/cli/package.json': '{"scripts":{"start":"cli start"}}'
    })
    const result = await discoverRunCommands(root)
    expect(
      result.commands.map((command) => [command.source, command.executable])
    ).toEqual([
      ['apps/web/package.json', 'pnpm'],
      ['packages/tools/cli/package.json', 'yarn']
    ])
  })
  it('requires explicit selection for inherited conflicts and local locks conflicting with inherited declarations', async () => {
    const root = await fixture({
      'package.json':
        '{"packageManager":"pnpm@9.0.0","scripts":{"build":"workspace build"}}',
      'pnpm-lock.yaml': '',
      'apps/web/package.json': '{"scripts":{"dev":"web dev"}}',
      'apps/web/package-lock.json': ''
    })
    const result = await discoverRunCommands(root)
    expect(result.commands.map((command) => command.source)).toEqual([
      'package.json'
    ])
    expect(result.warnings.join(' ')).toMatch(
      /apps\/web\/package.json: conflicting/i
    )
    const explicit = await discoverRunCommands(root, {
      config: 'apps/web/package.json',
      manager: 'pnpm'
    })
    expect(explicit.commands[0].executable).toBe('pnpm')
    await writeFile(join(root, 'yarn.lock'), '')
    const inheritedConflict = await discoverRunCommands(root, {
      config: 'apps/web/package.json'
    })
    expect(inheritedConflict.commands).toHaveLength(0)
    expect(inheritedConflict.warnings.join(' ')).toMatch(/conflict/i)
  })
  it('does not inherit manager metadata from outside the selected checkout', async () => {
    const outer = await fixture({
      'package.json': '{"packageManager":"yarn@4.0.0"}',
      'yarn.lock': '',
      'checkout/apps/web/package.json': '{"scripts":{"dev":"web dev"}}'
    })
    const result = await discoverRunCommands(join(outer, 'checkout'))
    expect(result.commands[0].executable).toBe('npm')
  })
  it('surfaces ancestor lockfile conflicts for nested packages without local manager metadata', async () => {
    const root = await fixture({
      'pnpm-lock.yaml': '',
      'yarn.lock': '',
      'apps/web/package.json': '{"scripts":{"dev":"web dev"}}'
    })
    const result = await discoverRunCommands(root)
    expect(result.commands).toHaveLength(0)
    expect(result.warnings.join(' ')).toMatch(
      /apps\/web\/package.json: conflicting/i
    )
    const corrected = await discoverRunCommands(root, { manager: 'yarn' })
    expect(corrected.commands[0].executable).toBe('yarn')
  })
  it('requires explicit correction for unsafe ancestor lockfile metadata', async () => {
    const root = await fixture({
      'apps/web/package.json': '{"scripts":{"dev":"web dev"}}'
    })
    const outside = await fixture({})
    await symlink(
      outside,
      join(root, 'pnpm-lock.yaml'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    const result = await discoverRunCommands(root)
    expect(result.commands).toHaveLength(0)
    expect(result.warnings.join(' ')).toMatch(/unsafe.*choose a manager/i)
    const corrected = await discoverRunCommands(root, { manager: 'npm' })
    expect(corrected.commands[0].executable).toBe('npm')
  })
  it('requires a manager selection on conflicting lockfiles and never copies script code', async () => {
    const root = await fixture({
      'package.json': JSON.stringify({
        scripts: { dev: 'echo secret-script', test: 'test' }
      }),
      'yarn.lock': '',
      'package-lock.json': ''
    })
    const result = await discoverRunCommands(root)
    expect(result.commands).toHaveLength(0)
    expect(result.warnings.join(' ')).toMatch(/conflict/i)
    const selected = await discoverRunCommands(root, { manager: 'npm' })
    expect(selected.commands.map((c) => c.args)).toEqual([
      ['run', 'dev'],
      ['run', 'test']
    ])
    expect(JSON.stringify(selected)).not.toContain('secret-script')
  })
  it('obeys bounds and permits an explicit deeply nested config inside checkout', async () => {
    const root = await fixture({
      'a/b/c/d/package.json': '{"scripts":{"start":"node server.js"}}',
      'node_modules/evil/package.json': '{"scripts":{"dev":"bad"}}'
    })
    const bounded = await discoverRunCommands(root, { maxDepth: 1 })
    expect(bounded.limited).toBe(true)
    expect(bounded.commands).toHaveLength(0)
    const explicit = await discoverRunCommands(root, {
      config: 'a/b/c/d/package.json'
    })
    expect(explicit.commands).toHaveLength(1)
    await expect(
      discoverRunCommands(root, { config: '../package.json' })
    ).rejects.toThrow(/outside/i)
  })
  it('rejects explicit symlink config escaping checkout', async () => {
    const root = await fixture({})
    const outside = await fixture({
      'package.json': '{"scripts":{"dev":"bad"}}'
    })
    await symlink(
      outside,
      join(root, 'external'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    await expect(
      discoverRunCommands(root, { config: 'external/package.json' })
    ).rejects.toThrow(/outside|symlink/i)
  })
})
describe('local run override sanitation', () => {
  it('keeps explicit custom commands and drops traversal, malformed, and oversized entries', () => {
    const good = {
      id: 'custom:test',
      name: 'Test',
      cwd: '.',
      shellCommand: 'npm test'
    }
    expect(
      sanitizeRunOverrides([
        {
          projectId: 'p',
          folder: '/repo',
          commands: [
            good,
            { ...good, id: 'evil', cwd: '../other' },
            { ...good, id: 'null', shellCommand: 'a\0b' }
          ]
        }
      ])
    ).toEqual([{ projectId: 'p', folder: '/repo', commands: [good] }])
    expect(sanitizeRunOverrides(null)).toEqual([])
  })
})
