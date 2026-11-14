import { describe, expect, it } from 'vitest'
import { clampMoveIndex, setStarred, starredFirst, type Starrable } from '../../src/shared/starred'
import { snapshotWorkspace } from '../../src/shared/layouts'
import { migrateSettings } from '../../src/shared/settingsSchema'

type Item = Starrable & { id: string }
const item = (id: string, starred = false): Item => (starred ? { id, starred: true } : { id })
const ids = (items: Item[]): string[] => items.map((entry) => entry.id)

describe('starred ordering', () => {
  it('lists starred items first and keeps each group in order', () => {
    expect(ids(starredFirst([item('a'), item('b', true), item('c'), item('d', true)]))).toEqual(['b', 'd', 'a', 'c'])
  })

  it('pins to the end of the pinned group and unpins to the head of the rest', () => {
    const list = [item('a', true), item('b'), item('c'), item('d')]
    const pinned = setStarred(list, 'c', true)
    expect(ids(pinned)).toEqual(['a', 'c', 'b', 'd'])
    expect(pinned[1].starred).toBe(true)
    const unpinned = setStarred(pinned, 'a', false)
    expect(ids(unpinned)).toEqual(['c', 'a', 'b', 'd'])
    expect(unpinned[1].starred).toBeUndefined()
  })

  it('changes nothing when the state is already as asked or the id is unknown', () => {
    const list = [item('a', true), item('b')]
    expect(setStarred(list, 'a', true)).toEqual(list)
    expect(setStarred(list, 'x', true)).toEqual(list)
  })

  it('keeps a drag inside its own group', () => {
    const list = [item('a', true), item('b', true), item('c'), item('d'), item('e')]
    expect(clampMoveIndex(list, 0, 4)).toBe(1)
    expect(clampMoveIndex(list, 1, 0)).toBe(0)
    expect(clampMoveIndex(list, 4, 0)).toBe(2)
    expect(clampMoveIndex(list, 2, 3)).toBe(3)
    expect(clampMoveIndex(list, 9, 0)).toBe(9)
  })
})

describe('starred in the saved workspace', () => {
  const tab = { id: 't', agent: 'claude' as const, label: 'claude' }
  const snap = (id: string, starred?: boolean) => ({ id, projectId: 'p', fontSize: 16, activeTabId: 't', tabs: [tab], ...(starred ? { starred } : {}) })

  it('saves the flag only on starred panes', () => {
    const saved = snapshotWorkspace([snap('a', true), snap('b')], 'a')
    expect(saved.panes[0].starred).toBe(true)
    expect(saved.panes[1].starred).toBeUndefined()
  })

  it('reads the flag back, and treats older saves and junk as not pinned', () => {
    const raw = {
      projects: [{ id: 'p', name: 'P', folder: 'C:\p', defaultAgent: 'claude' }],
      workspace: {
        focusedIndex: 0,
        panes: [
          { projectId: 'p', activeIndex: 0, fontSize: 16, starred: true, tabs: [{ agent: 'claude', label: 'a' }] },
          { projectId: 'p', activeIndex: 0, fontSize: 16, starred: 'yes', tabs: [{ agent: 'claude', label: 'b' }] },
          { projectId: 'p', activeIndex: 0, fontSize: 16, tabs: [{ agent: 'claude', label: 'c' }] }
        ]
      }
    }
    const panes = migrateSettings(raw).workspace.panes
    expect(panes.map((pane) => pane.starred)).toEqual([true, undefined, undefined])
  })
})
