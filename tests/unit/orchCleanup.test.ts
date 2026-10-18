import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unlinkLinks } from '../../src/main/compare'
import { cleanUpRun } from '../../src/main/orch/cleanup'
import { createTaskWorktree, mergeTaskIntoRun, runWorktree } from '../../src/main/orch/worktrees'

const RUN_ID = 'run_cafe1234abcd'
const SHORT = 'cafe1234'
let root: string
let repo: string

const run = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.invalid', ...args], { cwd, encoding: 'utf8' }).trim()
const commit = (cwd: string, file: string, text: string): void => {
  writeFileSync(join(cwd, file), text)
  run(cwd, 'add', '-A')
  run(cwd, 'commit', '-m', file)
}
const branches = (): string[] => run(repo, 'branch', '--format=%(refname:short)').split('\n')

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'dawsha-cleanup-')))
  repo = join(root, 'app')
  mkdirSync(repo)
  run(repo, 'init', '-b', 'main')
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
  commit(repo, 'a.txt', 'a')
})
afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

describe('cleanUpRun', { timeout: 60_000 }, () => {
  it('removes the run and task worktrees, deletes merged branches and keeps an unmerged one', async () => {
    const one = await createTaskWorktree(repo, RUN_ID, 'T-1')
    commit(one.path, 'one.txt', '1')
    expect((await mergeTaskIntoRun(repo, RUN_ID, 'T-1')).ok).toBe(true)
    const two = await createTaskWorktree(repo, RUN_ID, 'T-2')
    commit(two.path, 'two.txt', '2')
    // The run branch is merged into main, but T-2 never reached the run branch.
    const runTree = await runWorktree(repo, RUN_ID)
    run(repo, 'merge', '--no-edit', `orch/${SHORT}/run`)

    const result = await cleanUpRun(repo, RUN_ID, () => 7)

    expect(result.removed).toBe(3)
    expect(result.failed).toEqual([])
    expect(existsSync(one.path) || existsSync(two.path) || existsSync(runTree.path)).toBe(false)
    expect([...result.deletedBranches].sort()).toEqual([`orch/${SHORT}/run`, `orch/${SHORT}/t-1`])
    expect(result.kept).toHaveLength(1)
    expect(result.kept[0]).toContain(`orch/${SHORT}/t-2`)
    expect(branches()).toContain(`orch/${SHORT}/t-2`)
    expect(branches()).not.toContain(`orch/${SHORT}/t-1`)
    expect(run(repo, 'worktree', 'list')).not.toContain('-orch-')
  })

  it('keeps a worktree with uncommitted files', async () => {
    const one = await createTaskWorktree(repo, RUN_ID, 'T-1')
    writeFileSync(join(one.path, 'wip.txt'), 'unsaved')
    const result = await cleanUpRun(repo, RUN_ID)
    expect(existsSync(join(one.path, 'wip.txt'))).toBe(true)
    expect(result.removed).toBe(0)
    expect(result.kept[0]).toContain('uncommitted')
  })

  it('never touches worktrees or branches the orchestrator did not create', async () => {
    const other = join(root, 'app-feature')
    run(repo, 'worktree', 'add', '-b', 'feature/x', other)
    await createTaskWorktree(repo, RUN_ID, 'T-1')
    await cleanUpRun(repo, RUN_ID)
    expect(existsSync(other)).toBe(true)
    expect(branches()).toContain('feature/x')
  })

  it('can run again after a partial clean-up', async () => {
    await createTaskWorktree(repo, RUN_ID, 'T-1')
    await cleanUpRun(repo, RUN_ID)
    const again = await cleanUpRun(repo, RUN_ID)
    expect(again.removed).toBe(0)
    expect(again.failed).toEqual([])
  })

  it('unlinks a node_modules junction instead of deleting what it points at', async () => {
    const outside = join(root, 'main-node-modules')
    mkdirSync(outside)
    writeFileSync(join(outside, 'keep.txt'), 'precious')
    const one = await createTaskWorktree(repo, RUN_ID, 'T-1')
    symlinkSync(outside, join(one.path, 'node_modules'), 'junction')
    const result = await cleanUpRun(repo, RUN_ID)
    expect(existsSync(one.path)).toBe(false)
    expect(result.failed).toEqual([])
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('precious')
  })
})

describe('unlinkLinks', () => {
  it('removes links but leaves their targets and real files alone', () => {
    const target = join(root, 'target')
    mkdirSync(target)
    writeFileSync(join(target, 'f.txt'), 'x')
    const dir = join(root, 'tree')
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'real.txt'), 'r')
    symlinkSync(target, join(dir, 'sub', 'link'), 'junction')
    unlinkLinks(dir)
    expect(existsSync(join(dir, 'sub', 'link'))).toBe(false)
    expect(existsSync(join(target, 'f.txt'))).toBe(true)
    expect(existsSync(join(dir, 'real.txt'))).toBe(true)
  })
})
