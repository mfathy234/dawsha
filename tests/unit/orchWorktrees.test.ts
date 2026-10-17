import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createTaskWorktree,
  ensureRunBranch,
  isOrchBranch,
  mergeTaskIntoRun,
  removeOrchWorktree,
  runBranch,
  runWorktree,
  taskBranch
} from '../../src/main/orch/worktrees'

const IDENTITY = ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid']
const RUN = 'run_1a2b3c4d5e6f'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8' }).trim()
}

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-orch-'))
  const repo = join(root, 'acme-web')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  return repo
}

function commitFile(cwd: string, name: string, content: string): void {
  writeFileSync(join(cwd, name), content)
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', `edit ${name}`)
}

describe('orch branch naming', () => {
  it('derives run and task branches', () => {
    expect(runBranch(RUN)).toBe('orch/1a2b3c4d/run')
    expect(runBranch('abcdef123456')).toBe('orch/abcdef12/run')
    expect(taskBranch(RUN, 'T-3')).toBe('orch/1a2b3c4d/t-3')
  })

  it('recognises only orch branches', () => {
    expect(isOrchBranch('orch/1a2b3c4d/run')).toBe(true)
    expect(isOrchBranch('orch/1a2b3c4d/t-3')).toBe(true)
    expect(isOrchBranch('main')).toBe(false)
    expect(isOrchBranch('compare/x7k2p9-a')).toBe(false)
    expect(isOrchBranch('orch/')).toBe(false)
    expect(isOrchBranch('orch/../x')).toBe(false)
  })
})

describe('ensureRunBranch', () => {
  it('creates the run branch from HEAD and is idempotent', async () => {
    const repo = makeRepo()
    const head = git(repo, 'rev-parse', 'HEAD')
    expect(await ensureRunBranch(repo, RUN)).toBe('orch/1a2b3c4d/run')
    expect(git(repo, 'rev-parse', 'orch/1a2b3c4d/run')).toBe(head)
    expect(await ensureRunBranch(repo, RUN)).toBe('orch/1a2b3c4d/run')
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
  })
})

describe('createTaskWorktree', () => {
  it('creates a sibling worktree on the task branch and is idempotent', async () => {
    const repo = makeRepo()
    const first = await createTaskWorktree(repo, RUN, 'T-3')
    expect(first.branch).toBe('orch/1a2b3c4d/t-3')
    expect(first.path).toBe(join(dirname(repo), 'acme-web-orch-1a2b3c4d-t-3'))
    expect(existsSync(first.path)).toBe(true)
    expect(git(first.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(first.branch)
    expect(git(repo, 'rev-parse', first.branch)).toBe(git(repo, 'rev-parse', 'orch/1a2b3c4d/run'))
    const again = await createTaskWorktree(repo, RUN, 'T-3')
    expect(again).toEqual(first)
  })
})

describe('runWorktree', () => {
  it('creates a worktree on the run branch and is idempotent', async () => {
    const repo = makeRepo()
    const first = await runWorktree(repo, RUN)
    expect(first.branch).toBe('orch/1a2b3c4d/run')
    expect(basename(first.path)).toBe('acme-web-orch-1a2b3c4d')
    expect(git(first.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(first.branch)
    expect(await runWorktree(repo, RUN)).toEqual(first)
  })
})

describe('mergeTaskIntoRun', () => {
  it('merges a task commit into the run branch', async () => {
    const repo = makeRepo()
    const task = await createTaskWorktree(repo, RUN, 't-1')
    commitFile(task.path, 'a.txt', 'from task\n')
    const result = await mergeTaskIntoRun(repo, RUN, 't-1')
    expect(result.ok).toBe(true)
    expect(result.conflict).toBe(false)
    const run = await runWorktree(repo, RUN)
    expect(readFileSync(join(run.path, 'a.txt'), 'utf8')).toBe('from task\n')
    expect(git(run.path, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3)
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
  })

  it('aborts on conflict and leaves the run worktree clean', async () => {
    const repo = makeRepo()
    const run = await runWorktree(repo, RUN)
    const task = await createTaskWorktree(repo, RUN, 't-2')
    commitFile(task.path, 'README.md', 'task side\n')
    commitFile(run.path, 'README.md', 'run side\n')
    const result = await mergeTaskIntoRun(repo, RUN, 't-2')
    expect(result.ok).toBe(false)
    expect(result.conflict).toBe(true)
    expect(result.message).not.toBe('')
    expect(existsSync(join(git(run.path, 'rev-parse', '--git-dir'), 'MERGE_HEAD'))).toBe(false)
    expect(git(run.path, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(run.path, 'README.md'), 'utf8')).toBe('run side\n')
  })
})

describe('removeOrchWorktree', () => {
  it('refuses non-orch branches and non-orch paths', async () => {
    const repo = makeRepo()
    await expect(removeOrchWorktree(repo, join(dirname(repo), 'acme-web-orch-x'), 'main')).rejects.toThrow(/orchestrator/i)
    await expect(removeOrchWorktree(repo, repo, 'orch/1a2b3c4d/run')).rejects.toThrow(/orchestrator/i)
    expect(existsSync(repo)).toBe(true)
  })

  it('removes the worktree and deletes the branch when asked', async () => {
    const repo = makeRepo()
    const task = await createTaskWorktree(repo, RUN, 't-4')
    await removeOrchWorktree(repo, task.path, task.branch, { deleteBranch: true })
    expect(existsSync(task.path)).toBe(false)
    expect(git(repo, 'branch', '--list', task.branch)).toBe('')
    expect(git(repo, 'branch', '--list', 'orch/1a2b3c4d/run')).not.toBe('')
  })

  it('keeps the branch by default', async () => {
    const repo = makeRepo()
    const task = await createTaskWorktree(repo, RUN, 't-5')
    await removeOrchWorktree(repo, task.path, task.branch)
    expect(existsSync(task.path)).toBe(false)
    expect(git(repo, 'branch', '--list', task.branch)).not.toBe('')
  })
})
