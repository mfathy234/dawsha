import { describe, expect, it } from 'vitest'
import { groupCheckouts, totalFiles, type CheckoutInput } from '../../src/shared/allSessions'

const file = (path: string, added: number | null = 1, removed: number | null = 0) => ({ path, letter: 'M', added, removed })
const make = (over: Partial<CheckoutInput>): CheckoutInput => ({ folder: 'C:/p', main: false, branch: null, files: [file('a.ts')], sessions: [], ...over })

describe('groupCheckouts', () => {
  it('puts the main checkout first and worktrees by their session title', () => {
    const groups = groupCheckouts([
      make({ folder: 'C:/p-wt-b', sessions: [{ paneId: 'p2', title: 'Beta', agent: 'codex' }] }),
      make({ folder: 'C:/p', main: true, sessions: [{ paneId: 'p1', title: 'Main work', agent: 'claude' }] }),
      make({ folder: 'C:/p-wt-a', sessions: [{ paneId: 'p3', title: 'Alpha', agent: 'claude' }] })
    ])
    expect(groups.map((group) => group.heading)).toEqual(['Main checkout', 'Alpha', 'Beta'])
  })
  it('leaves out checkouts with nothing changed and totals the rest', () => {
    const groups = groupCheckouts([make({ folder: 'C:/x', files: [] }), make({ folder: 'C:/p', main: true, files: [file('b.ts', 3, 1), file('a.ts', null, 2)] })])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ added: 3, removed: 3 })
    expect(groups[0].files.map((entry) => entry.path)).toEqual(['a.ts', 'b.ts'])
    expect(totalFiles(groups)).toBe(2)
  })
  it('merges sessions that share a checkout without repeating one', () => {
    const groups = groupCheckouts([
      make({ folder: 'C:/p', main: true, sessions: [{ paneId: 'p1', title: 'One', agent: 'claude' }] }),
      make({ folder: 'C:/p', main: true, sessions: [{ paneId: 'p1', title: 'One', agent: 'claude' }, { paneId: 'p2', title: 'Two', agent: 'codex' }] })
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].sessions.map((session) => session.paneId)).toEqual(['p1', 'p2'])
  })
  it('falls back to the branch, then the folder, for a worktree with no session', () => {
    expect(groupCheckouts([make({ branch: 'feat/x' })])[0].heading).toBe('feat/x')
    expect(groupCheckouts([make({})])[0].heading).toBe('C:/p')
  })
})
