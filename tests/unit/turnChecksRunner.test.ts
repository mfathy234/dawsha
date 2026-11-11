import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { RunCommand } from '../../src/shared/runCommands'
import type { CheckRunUpdate } from '../../src/shared/turnChecks'
import { TurnChecksRunner } from '../../src/main/turnChecksRunner'

const command = (id: string): RunCommand => ({ id, name: id, cwd: '.', source: 'package.json', display: `npm run ${id}`, shellCommand: id })

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  constructor(readonly pid: number) { super() }
  finish(out: string, code: number): void {
    this.stdout.emit('data', Buffer.from(out))
    this.emit('close', code)
  }
}

function setup(ids: string[]): { runner: TurnChecksRunner; updates: CheckRunUpdate[]; children: FakeChild[]; killed: number[]; cwds: string[] } {
  const updates: CheckRunUpdate[] = []
  const children: FakeChild[] = []
  const killed: number[] = []
  const cwds: string[] = []
  let clock = 0
  const runner = new TurnChecksRunner((update) => updates.push(update), {
    resolve: async () => ids.map((id) => ({ command: command(id), cwd: `/work/${id}` })),
    spawn: ((_file: string, _args: string[], options: { cwd?: string }) => {
      cwds.push(String(options.cwd))
      const child = new FakeChild(100 + children.length)
      children.push(child)
      return child
    }) as never,
    kill: async (pid) => { killed.push(pid) },
    prepare: () => ({ file: 'x', args: [] }),
    now: () => (clock += 1000)
  })
  return { runner, updates, children, killed, cwds }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('TurnChecksRunner', () => {
  it('runs the checks one after another in their folders and reports each', async () => {
    const { runner, updates, children, cwds } = setup(['lint', 'test'])
    await runner.start('/work', 'p', 's1', ['lint', 'test'])
    expect(updates[0].results.map((r) => r.status)).toEqual(['queued', 'queued'])
    await tick()
    expect(children).toHaveLength(1)
    expect(updates.at(-1)!.results.map((r) => r.status)).toEqual(['running', 'queued'])
    children[0].finish('ok', 0)
    await tick()
    expect(children).toHaveLength(2)
    children[1].finish('Tests  2 failed | 146 passed (148)\n  ✕ a › b\n    Expected: 1', 1)
    await tick()
    const last = updates.at(-1)!
    expect(last.done).toBe(true)
    expect(last.results[0]).toMatchObject({ status: 'passed', exitCode: 0, seconds: 1 })
    expect(last.results[1]).toMatchObject({ status: 'failed', exitCode: 1, counts: '2 of 148 failed' })
    expect(last.results[1].excerpt).toContain('✕ a › b')
    expect(cwds).toEqual(['/work/lint', '/work/test'])
  })

  it('kills the running check and starts no more when stopped', async () => {
    const { runner, updates, children, killed } = setup(['a', 'b'])
    await runner.start('/work', 'p', 's1', ['a', 'b'])
    await tick()
    const before = updates.length
    await runner.stop('s1')
    expect(killed).toEqual([100])
    children[0].finish('', 1)
    await tick()
    expect(children).toHaveLength(1)
    expect(updates).toHaveLength(before)
  })

  it('replaces a session\'s earlier run and keeps sessions apart', async () => {
    const { runner, children, killed } = setup(['a'])
    await runner.start('/work', 'p', 's1', ['a'])
    await runner.start('/work', 'p', 's2', ['a'])
    await tick()
    expect(killed).toEqual([])
    await runner.start('/work', 'p', 's1', ['a'])
    expect(killed).toEqual([100])
    expect(children.length).toBeGreaterThanOrEqual(2)
  })

  it('reports a command that cannot start as failed', async () => {
    const updates: CheckRunUpdate[] = []
    const runner = new TurnChecksRunner((update) => updates.push(update), {
      resolve: async () => [{ command: command('a'), cwd: '/work' }],
      prepare: () => { throw new Error('npm is not installed') }
    })
    await runner.start('/work', 'p', 's1', ['a'])
    await tick()
    expect(updates.at(-1)!.results[0]).toMatchObject({ status: 'failed', exitCode: null })
    expect(updates.at(-1)!.results[0].output).toContain('npm is not installed')
  })

  it('refuses a run with nothing to run', async () => {
    const runner = new TurnChecksRunner(() => undefined, { resolve: async () => [] })
    await expect(runner.start('/work', 'p', 's1', ['a'])).rejects.toThrow('None of the chosen commands')
  })

  it('stops every run on dispose', async () => {
    const { runner, killed } = setup(['a'])
    await runner.start('/work', 'p', 's1', ['a'])
    await runner.start('/work', 'p', 's2', ['a'])
    await tick()
    await runner.dispose()
    expect(killed.sort()).toEqual([100, 101])
  })
})
