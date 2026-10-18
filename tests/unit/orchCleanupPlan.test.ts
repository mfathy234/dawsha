import { describe, expect, it } from 'vitest'
import { planCleanup, type CleanupBranch, type CleanupWorktree } from '../../src/main/orch/cleanupPlan'

const RUN = 'orch/abc/run'
const tree = (branch: string, dirty = false): CleanupWorktree => ({ path: `C:/w-orch-abc-${branch.split('/')[2]}`, branch, dirty })
const branch = (name: string, facts: Partial<CleanupBranch> = {}): CleanupBranch => ({ name, inRun: false, inBase: false, pushed: false, ...facts })

describe('planCleanup', () => {
  it('removes every clean worktree', () => {
    const plan = planCleanup(RUN, [tree('orch/abc/t-1'), tree(RUN)], [])
    expect(plan.removeWorktrees.map((t) => t.branch)).toEqual(['orch/abc/t-1', RUN])
    expect(plan.kept).toEqual([])
  })

  it('deletes branches merged into the run, the base or a remote', () => {
    const plan = planCleanup(RUN, [], [
      branch('orch/abc/t-1', { inRun: true }),
      branch('orch/abc/t-2', { inBase: true }),
      branch('orch/abc/t-3', { pushed: true }),
      branch(RUN, { inBase: true })
    ])
    expect(plan.deleteBranches).toEqual(['orch/abc/t-1', 'orch/abc/t-2', 'orch/abc/t-3', RUN])
  })

  it('keeps and reports a branch with unmerged, unpushed commits', () => {
    const plan = planCleanup(RUN, [], [branch('orch/abc/t-1'), branch(RUN)])
    expect(plan.deleteBranches).toEqual([])
    expect(plan.kept).toHaveLength(2)
    expect(plan.kept[0]).toContain('orch/abc/t-1')
  })

  it('does not delete the run branch only because it contains itself', () => {
    const plan = planCleanup(RUN, [], [branch(RUN, { inRun: true })])
    expect(plan.deleteBranches).toEqual([])
  })

  it('keeps a worktree with uncommitted files, and its branch', () => {
    const plan = planCleanup(RUN, [tree('orch/abc/t-1', true)], [branch('orch/abc/t-1', { inBase: true })])
    expect(plan.removeWorktrees).toEqual([])
    expect(plan.deleteBranches).toEqual([])
    expect(plan.kept[0]).toContain('uncommitted')
  })
})
