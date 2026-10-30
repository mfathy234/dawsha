import { describe, expect, it } from 'vitest'
import { projectBranches } from '../../src/shared/projectTree'
import { truncateMiddle } from '../../src/shared/pathText'

const projects = [
  { id: 'dawsha', name: 'Dawsha', folder: 'C:/work/dawsha' },
  { id: 'wt', name: 'dawsha-wt-180-design', folder: 'C:/work/dawsha-wt-180-design' },
  { id: 'other', name: 'Other', folder: 'C:/work/other' },
  { id: 'orphan', name: 'Orphan', folder: 'C:/work/orphan-wt' }
]
const groups = {
  dawsha: { rootId: 'dawsha', worktree: null },
  wt: { rootId: 'dawsha', worktree: 'dawsha-wt-180-design' },
  other: { rootId: 'other', worktree: null },
  orphan: { rootId: 'missing', worktree: 'orphan-wt' }
}

describe('projectBranches', () => {
  it('lists a worktree under its project instead of as a project of its own', () => {
    const rows = projectBranches(projects, groups)
    expect(rows.map((row) => row.project.id)).toEqual(['dawsha', 'other', 'orphan'])
    expect(rows[0].worktrees.map((project) => project.id)).toEqual(['wt'])
    expect(rows[1].worktrees).toEqual([])
  })

  it('keeps a worktree whose project is not configured as a row of its own', () => {
    const rows = projectBranches([{ id: 'orphan', name: 'Orphan', folder: 'C:/work/orphan-wt' }], { orphan: { rootId: 'gone', worktree: 'orphan-wt' } })
    expect(rows).toEqual([{ project: { id: 'orphan', name: 'Orphan', folder: 'C:/work/orphan-wt' }, worktrees: [] }])
  })

  it('treats a project with no group as its own row', () => {
    expect(projectBranches(projects, {}).map((row) => row.worktrees.length)).toEqual([0, 0, 0, 0])
  })
})

describe('truncateMiddle', () => {
  it('leaves short paths alone', () => {
    expect(truncateMiddle('C:/work/app', 40)).toBe('C:/work/app')
  })
  it('keeps the start and the end of a long path, with one ellipsis', () => {
    const cut = truncateMiddle('C:/Users/someone/Desktop/Work/dawsha-wt-180-design', 30)
    expect(cut).toHaveLength(30)
    expect(cut.startsWith('C:/Users')).toBe(true)
    expect(cut.endsWith('180-design')).toBe(true)
    expect(cut).toContain('…')
  })
})
