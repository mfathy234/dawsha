import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunCommandService } from '../../src/main/runCommands/service'
import type {
  RunCommand,
  RunOverrides,
  RunSnapshot,
  RunTarget
} from '../../src/shared/runCommands'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})
async function setup() {
  const folder = await mkdtemp(join(tmpdir(), 'dawsha-run-service-'))
  roots.push(folder)
  await writeFile(
    join(folder, 'package.json'),
    '{"scripts":{"dev":"node server.js"}}'
  )
  let overrides: RunOverrides = []
  const store = {
    get: () => ({ projects: [{ id: 'p', folder }], runCommands: overrides }),
    update: (patch: { runCommands: RunOverrides }) => {
      overrides = patch.runCommands
    }
  }
  const runner = {
    start: vi.fn(
      (target: RunTarget, command: RunCommand, cwd: string): RunSnapshot => ({
        id: 'run',
        commandId: command.id,
        name: command.name,
        ...target,
        cwd,
        display: command.display,
        status: 'running',
        output: '',
        exitCode: null,
        startedAt: Date.now()
      })
    ),
    list: vi.fn(() => []),
    stop: vi.fn(async () => {}),
    dispose: vi.fn()
  }
  const service = new RunCommandService(store, runner)
  return { folder, store, runner, service, target: { projectId: 'p', folder } }
}
describe('server-side command selection', () => {
  it('launches only a selected server command and rejects injected executable or stale selection', async () => {
    const { service, target, runner } = await setup()
    const selected = await service.discover(target)
    await expect(
      service.start({
        selectionId: selected.selectionId,
        commandId: 'invented',
        executable: 'evil'
      })
    ).rejects.toThrow(/selected|available/i)
    await service.start({
      selectionId: selected.selectionId,
      commandId: selected.commands[0].id,
      executable: 'evil',
      cwd: '/outside'
    })
    expect(runner.start.mock.calls[0][1]).toMatchObject({
      executable: 'npm',
      args: ['run', 'dev']
    })
    expect(runner.start.mock.calls[0][2]).toBe(target.folder)
    service.dispose()
    await expect(
      service.start({
        selectionId: selected.selectionId,
        commandId: selected.commands[0].id
      })
    ).rejects.toThrow(/closed|again/i)
  })
  it('saves explicit local shell overrides, validates cwd, and custom overrides win on rescan', async () => {
    const { service, target, folder } = await setup()
    const first = await service.discover(target)
    const edited = {
      id: first.commands[0].id,
      name: 'Edited dev',
      cwd: '.',
      shellCommand: 'npm run dev -- --port 4444'
    }
    await service.save(target, [edited])
    const selected = await service.discover(target)
    expect(selected.commands).toHaveLength(1)
    expect(selected.commands[0].shellCommand).toBe(edited.shellCommand)
    await expect(
      service.save(target, [{ ...edited, cwd: '../outside' }])
    ).rejects.toThrow()
    await mkdir(join(folder, 'app'))
    await service.save(target, [{ ...edited, cwd: 'app' }])
    await rm(join(folder, 'app'), { recursive: true })
    await symlink(
      tmpdir(),
      join(folder, 'app'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    await expect(
      service.start({ selectionId: selected.selectionId, commandId: edited.id })
    ).rejects.toThrow(/symlink/i)
    service.dispose()
  })
  it('binds a configured project id to its own authorized folder', async () => {
    const { service, target } = await setup()
    await expect(
      service.discover({ ...target, projectId: 'other' })
    ).rejects.toThrow(/project/i)
    await expect(
      service.discover({ ...target, folder: tmpdir() })
    ).rejects.toThrow(/checkout|project/i)
    service.dispose()
  })
  it('rejects Git metadata even when it is beneath a known project', async () => {
    const { service, target, folder } = await setup()
    await mkdir(join(folder, '.git'))
    await expect(
      service.discover({ ...target, folder: join(folder, '.git') })
    ).rejects.toThrow(/metadata/i)
    service.dispose()
  })
})
