import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  RunProcesses,
  type RunProcessDependencies
} from '../../src/main/runCommands/processes'
import type { RunCommand } from '../../src/shared/runCommands'

const command: RunCommand = {
  id: 'node:start',
  name: 'Start',
  cwd: '.',
  source: 'package.json',
  display: 'npm run start',
  executable: 'npm',
  args: ['run', 'start']
}
const target = { projectId: 'p', folder: '/checkout' }
function setup() {
  const children: Array<
    EventEmitter & { pid: number; stdout: EventEmitter; stderr: EventEmitter }
  > = []
  const spawn = vi.fn<RunProcessDependencies['spawn']>(() => {
    const c = Object.assign(new EventEmitter(), {
      pid: 100 + children.length,
      stdout: new EventEmitter(),
      stderr: new EventEmitter()
    })
    children.push(c)
    return c
  })
  const kill = vi.fn(async () => {})
  const runner = new RunProcesses(() => {}, {
    spawn,
    kill,
    prepare: (c) => ({ file: c.executable!, args: c.args! }),
    platform: 'linux'
  })
  return { runner, spawn, kill, children }
}
describe('dedicated run processes', () => {
  it('captures cwd, rejects duplicates and retains failed output independent of target switches', async () => {
    const { runner, spawn, children } = setup()
    const run = runner.start(target, command, '/checkout/app')
    expect(spawn.mock.calls[0][2]).toMatchObject({
      cwd: '/checkout/app',
      detached: true,
      shell: false
    })
    expect(() => runner.start(target, command, '/checkout/app')).toThrow(
      /already running/i
    )
    children[0].stdout.emit('data', Buffer.from('first\n'))
    children[0].stderr.emit('data', Buffer.from('port in use'))
    children[0].emit('close', 1)
    expect(runner.list()[0]).toMatchObject({
      id: run.id,
      cwd: '/checkout/app',
      status: 'failed',
      exitCode: 1,
      output: 'first\nport in use'
    })
    expect(
      runner.start({ ...target, folder: '/other' }, command, '/other').folder
    ).toBe('/other')
    runner.dispose()
  })
  it('stops only the chosen process tree and disposes every owned run', async () => {
    const { runner, kill, children } = setup()
    const one = runner.start(target, command, '/checkout')
    runner.start({ ...target, folder: '/other' }, command, '/other')
    await runner.stop(one.id)
    expect(kill).toHaveBeenCalledExactlyOnceWith(children[0].pid)
    expect(runner.list()[0].status).toBe('stopping')
    children[0].emit('close', 1)
    expect(runner.list()[0].status).toBe('stopped')
    runner.dispose()
    expect(kill).toHaveBeenCalledWith(children[1].pid)
    expect(() => runner.start(target, command, '/checkout')).toThrow(/closed/i)
  })
  it('bounds output, reports spawn errors and allows an explicit run again', () => {
    const { runner, children } = setup()
    runner.start(target, command, '/checkout')
    children[0].stdout.emit('data', Buffer.from('x'.repeat(300000)))
    expect(runner.list()[0].output.length).toBeLessThanOrEqual(200000)
    children[0].emit(
      'error',
      Object.assign(new Error('not installed'), { code: 'ENOENT' })
    )
    expect(runner.list()[0]).toMatchObject({ status: 'failed', exitCode: null })
    expect(runner.list()[0].output).toMatch(/not installed/)
    expect(() => runner.start(target, command, '/checkout')).not.toThrow()
    runner.dispose()
  })
  it('waits for owned process trees during shutdown', async () => {
    const { runner, kill } = setup()
    let resolveKill!: () => void
    kill.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveKill = resolve
        })
    )
    runner.start(target, command, '/checkout')
    let finished = false
    const closing = runner.dispose().then(() => {
      finished = true
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    resolveKill()
    await closing
    expect(finished).toBe(true)
  })
  it('shares an in-flight Stop with repeated clicks and shutdown', async () => {
    const { runner, kill } = setup()
    let resolveKill!: () => void
    kill.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveKill = resolve
        })
    )
    const run = runner.start(target, command, '/checkout')
    const stopping = runner.stop(run.id)
    const again = runner.stop(run.id)
    const closing = runner.dispose()
    expect(kill).toHaveBeenCalledTimes(1)
    resolveKill()
    await Promise.all([stopping, again, closing])
  })
})
