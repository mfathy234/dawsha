import { describe, expect, it } from 'vitest'
import { sessionWorkItems } from '../../src/main/workDashboard'
import { groupWorktreeProjects } from '../../src/shared/worktreeGroups'
import type { ResumeSession } from '../../src/shared/types'

const base = [
  { id: 'dawsha', name: 'Dawsha', folder: 'C:/work/dawsha' },
  { id: 'wt', name: 'dawsha-wt-180-design', folder: 'C:/work/dawsha-wt-180-design' },
  { id: 'other', name: 'Other', folder: 'C:/work/other' }
]
const projects = base.map(project => ({ ...project, defaultAgent: 'claude' as const }))
const mainOf = (folder: string): string | null => {
  if (folder.toLowerCase().startsWith('c:/work/dawsha')) return 'C:/work/dawsha'
  if (folder === 'C:/work/other') return 'C:/work/other'
  return null
}

describe('groupWorktreeProjects', () => {
  it('counts a worktree under the project whose checkout it is, and names the worktree by its folder', () => {
    const groups = groupWorktreeProjects(projects, mainOf)
    expect(groups.get('wt')).toEqual({ rootId: 'dawsha', worktree: 'dawsha-wt-180-design' })
    expect(groups.get('dawsha')).toEqual({ rootId: 'dawsha', worktree: null })
    expect(groups.get('other')).toEqual({ rootId: 'other', worktree: null })
  })

  it('compares folders without regard to slashes, trailing slashes or drive-letter case', () => {
    const groups = groupWorktreeProjects(
      [{ id: 'a', name: 'A', folder: 'c:\\work\\app\\' }, { id: 'b', name: 'B', folder: 'C:/work/app-wt' }],
      (folder) => (folder.endsWith('app-wt') ? 'C:\\work\\app' : null)
    )
    expect(groups.get('b')).toEqual({ rootId: 'a', worktree: 'app-wt' })
  })

  it('keeps a worktree on its own when its main checkout is not a configured project', () => {
    const groups = groupWorktreeProjects([{ id: 'wt', name: 'Solo', folder: 'C:/elsewhere/solo' }], () => 'C:/elsewhere/missing')
    expect(groups.get('wt')).toEqual({ rootId: 'wt', worktree: null })
  })

  it('keeps a project that is not a git checkout on its own', () => {
    const groups = groupWorktreeProjects([{ id: 'plain', name: 'Plain', folder: 'C:/notes' }], () => null)
    expect(groups.get('plain')).toEqual({ rootId: 'plain', worktree: null })
  })
})

const session = (overrides: Partial<ResumeSession>): ResumeSession => ({
  id: 's', agent: 'claude', projectId: 'wt', title: 'Work', startedAt: 1000, modifiedAt: 9000, lastActivityAt: 2000,
  messageCount: 2, workBranch: 'fix/18550', ...overrides
})
const noCommits = async (): Promise<string[]> => []

describe('sessionWorkItems grouping', () => {
  it('counts a worktree session under its main project and shows the worktree on the item', async () => {
    const items = await sessionWorkItems([session({ id: 'a', projectId: 'wt' }), session({ id: 'b', projectId: 'dawsha', workBranch: 'main' })], projects, noCommits, async (folder) => mainOf(folder))
    expect(items.map((item) => [item.projectId, item.project, item.worktree ?? null, item.branch])).toEqual([
      ['dawsha', 'Dawsha', 'dawsha-wt-180-design', 'fix/18550'],
      ['dawsha', 'Dawsha', null, 'main']
    ])
  })

  it('leaves a project without a known main checkout as its own project', async () => {
    const items = await sessionWorkItems([session({ id: 'c', projectId: 'other' })], projects, noCommits, async (folder) => mainOf(folder))
    expect(items[0]).toMatchObject({ projectId: 'other', project: 'Other' })
    expect(items[0].worktree).toBeUndefined()
  })
})
