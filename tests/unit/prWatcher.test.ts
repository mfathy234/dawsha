import { describe, expect, it } from 'vitest'
import { PrWatcher } from '../../src/main/prWatcher'
import { buildFixMessage, mergeWatched } from '../../src/main/prWatchTasks'
import type { GhRun } from '../../src/main/ghRunner'
import type { PrWatchUpdate } from '../../src/shared/prWatch'

const SHA = 'c'.repeat(40)
const view = (over: Record<string, unknown> = {}): string => JSON.stringify({ number: 34, title: 'T', url: 'https://github.com/o/r/pull/34', state: 'OPEN', isDraft: false, mergeStateStatus: 'CLEAN', headRefOid: SHA, headRefName: 'feature/x', baseRefName: 'main', statusCheckRollup: [], ...over })
const ok = (stdout: string): GhRun => ({ ok: true, missing: false, stdout, message: '' })
const bad = (message: string): GhRun => ({ ok: false, missing: false, stdout: '', message })

function setup(reply: (args: readonly string[]) => GhRun | Promise<GhRun>, visible = () => true) {
  const clock = { now: 1_000_000 }
  const calls: string[][] = []
  const updates: PrWatchUpdate[] = []
  const watcher = new PrWatcher({
    runGh: async (_cwd, args) => { calls.push([...args]); return reply(args) },
    now: () => clock.now,
    visible,
    emit: (update) => updates.push(update),
    known: async (folder) => folder
  })
  return { clock, calls, updates, watcher }
}

describe('PrWatcher', () => {
  it('polls a known pull request by number every 60 s while visible', async () => {
    const { clock, calls, updates, watcher } = setup(() => ok(view()))
    await watcher.sync([{ key: 'p1', folder: '/r', number: 34 }])
    await watcher.tick()
    expect(calls[0].slice(0, 3)).toEqual(['pr', 'view', '34'])
    expect(updates).toHaveLength(1)
    clock.now += 30_000
    await watcher.tick()
    expect(calls).toHaveLength(1)
    clock.now += 31_000
    await watcher.tick()
    expect(calls).toHaveLength(2)
    expect(updates).toHaveLength(1)
  })

  it('backs off while the window is hidden', async () => {
    let visible = true
    const { clock, calls, watcher } = setup(() => ok(view()), () => visible)
    await watcher.sync([{ key: 'p1', folder: '/r', number: 34 }])
    await watcher.tick()
    visible = false
    clock.now += 120_000
    await watcher.tick()
    expect(calls).toHaveLength(1)
    clock.now += 200_000
    await watcher.tick()
    expect(calls).toHaveLength(2)
  })

  it('never runs two polls of the same pull request at once', async () => {
    let release: (run: GhRun) => void = () => undefined
    const { calls, watcher } = setup(() => new Promise<GhRun>((done) => { release = done }))
    await watcher.sync([{ key: 'p1', folder: '/r', number: 34 }, { key: 'p2', folder: '/r', number: 34 }])
    const first = watcher.tick()
    await watcher.tick()
    expect(calls).toHaveLength(1)
    release(ok(view()))
    await first
  })

  it('backs off after failures and recovers', async () => {
    let fail = true
    const { clock, calls, watcher } = setup(() => (fail ? bad('network down') : ok(view())))
    await watcher.sync([{ key: 'p1', folder: '/r', number: 34 }])
    await watcher.tick()
    clock.now += 61_000
    await watcher.tick()
    expect(calls).toHaveLength(1)
    clock.now += 70_000
    fail = false
    await watcher.tick()
    expect(calls).toHaveLength(2)
  })

  it('finds the pull request of a branch, stops on merge, and ignores default branches', async () => {
    let state = 'OPEN'
    const { clock, calls, updates, watcher } = setup(() => ok(view({ state })))
    await watcher.sync([{ key: 'p1', folder: '/r', number: null }])
    await watcher.tick()
    expect(calls[0]).toEqual(['pr', 'view', '--json', expect.any(String)])
    state = 'MERGED'
    clock.now += 61_000
    await watcher.tick()
    expect(updates.at(-1)?.state?.phase).toBe('merged')
    clock.now += 600_000
    await watcher.tick()
    expect(calls).toHaveLength(2)
    const main = setup(() => ok(view({ headRefName: 'main' })))
    await main.watcher.sync([{ key: 'p1', folder: '/r', number: null }])
    await main.watcher.tick()
    expect(main.updates).toHaveLength(0)
  })

  it('reports no state for a branch without a pull request or a non-GitHub remote', async () => {
    const none = setup(() => bad('no pull requests found for branch "x"'))
    await none.watcher.sync([{ key: 'p1', folder: '/r', number: null }])
    await none.watcher.tick()
    expect(none.updates).toHaveLength(0)
    const other = setup(() => bad('none of the git remotes configured for this repository point to a known GitHub host'))
    await other.watcher.sync([{ key: 'p1', folder: '/r', number: null }])
    await other.watcher.tick()
    other.clock.now += 120_000
    await other.watcher.tick()
    expect(other.calls).toHaveLength(1)
  })

  it('drops entries the renderer no longer lists', async () => {
    const { watcher } = setup(() => ok(view()))
    await watcher.sync([{ key: 'p1', folder: '/r', number: 34 }])
    await watcher.sync([])
    expect(watcher.size()).toBe(0)
  })
})

describe('Fix CI and merge', () => {
  const failed = [{ name: 'build', workflow: 'CI', bucket: 'fail' as const, link: 'l', runId: '555' }, { name: 'lint', workflow: 'CI', bucket: 'fail' as const, link: 'l2', runId: '555' }]
  it('fetches the failed log once per run and trims it', async () => {
    const calls: string[][] = []
    const result = await buildFixMessage('/r', 34, failed, async (_cwd, args) => { calls.push([...args]); return ok('build\tTest\t2026-01-01T00:00:00Z FAIL a.test.ts\n') })
    expect(calls).toEqual([['run', 'view', '555', '--log-failed']])
    expect(result).toMatchObject({ ok: true })
    expect(result.ok && result.message).toContain('CI failed on PR #34: CI / build, CI / lint: FAIL a.test.ts')
    expect(await buildFixMessage('/r', 34, [], async () => ok(''))).toMatchObject({ ok: false })
  })

  it('merges with the project command only when open, unchanged and ready', async () => {
    const calls: string[][] = []
    const reply = (over: Record<string, unknown>) => async (_cwd: string, args: readonly string[]): Promise<GhRun> => { calls.push([...args]); return args[1] === 'view' ? ok(view(over)) : ok('merged') }
    const request = { number: 34, headSha: SHA, command: 'gh pr merge <n> --squash --admin' }
    expect(await mergeWatched('/r', request, reply({}))).toEqual({ ok: true, message: 'Merged PR #34.' })
    expect(calls.at(-1)).toEqual(['pr', 'merge', '34', '--squash', '--admin', `--match-head-commit=${SHA}`])
    calls.length = 0
    expect(await mergeWatched('/r', request, reply({ headRefOid: 'd'.repeat(40) }))).toMatchObject({ ok: false })
    expect(await mergeWatched('/r', request, reply({ state: 'MERGED' }))).toMatchObject({ ok: false })
    expect(await mergeWatched('/r', { ...request, command: 'gh pr merge <n> --squash' }, reply({ mergeStateStatus: 'BLOCKED' }))).toMatchObject({ ok: false })
    expect(calls.every((call) => call[1] === 'view')).toBe(true)
  })
})
