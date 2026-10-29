import { describe, expect, it } from 'vitest'
import { canMoveProject, moveFromDisplay, moveProject, orderProjects, reorderFromDisplay, seedOrder, setProjectPinned } from '../../src/shared/projectOrder'
import { projectStatus, projectStatusLabel, projectStatusText } from '../../src/shared/projectStatus'
import type { Project } from '../../src/shared/types'

const p = (id: string, pinned = false): Project => ({ id, name: id, folder: `/${id}`, defaultAgent: 'claude', ...(pinned ? { pinned: true } : {}) })
const ids = (projects: Project[]): string[] => projects.map((x) => x.id)

describe('project order', () => {
  it('lists pinned projects first and keeps each group in stored order', () => {
    const list = [p('a'), p('b', true), p('c'), p('d', true)]
    expect(ids(orderProjects(list))).toEqual(['b', 'd', 'a', 'c'])
    expect(ids(list)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('moves a project past its neighbour of the same group, skipping the other group', () => {
    const list = [p('a'), p('b', true), p('c'), p('d', true)]
    expect(ids(moveProject(list, 'c', -1))).toEqual(['c', 'b', 'a', 'd'])
    expect(ids(moveProject(list, 'b', 1))).toEqual(['a', 'd', 'c', 'b'])
    expect(ids(list)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('cannot move past the ends of its group', () => {
    const list = [p('a'), p('b', true), p('c')]
    expect(canMoveProject(list, 'a', -1)).toBe(false)
    expect(canMoveProject(list, 'a', 1)).toBe(true)
    expect(canMoveProject(list, 'b', 1)).toBe(false)
    expect(canMoveProject(list, 'c', 1)).toBe(false)
    expect(ids(moveProject(list, 'c', 1))).toEqual(['a', 'b', 'c'])
    expect(canMoveProject(list, 'nope', 1)).toBe(false)
  })

  it('pins and unpins without touching the original', () => {
    const list = [p('a'), p('b')]
    const pinned = setProjectPinned(list, 'b', true)
    expect(pinned[1].pinned).toBe(true)
    expect(list[1].pinned).toBeUndefined()
    const back = setProjectPinned(pinned, 'b', false)
    expect('pinned' in back[1]).toBe(false)
    expect(back[0]).toBe(list[0])
  })
})

describe('project status in the collapsed sidebar', () => {
  it('prefers a needs count over working', () => {
    expect(projectStatus(['needs', 'working', 'needs', 'idle'])).toEqual({ needs: 2, working: 1 })
    expect(projectStatusText({ needs: 2, working: 1 })).toBe('2 need you')
    expect(projectStatusText({ needs: 1, working: 0 })).toBe('1 needs you')
    expect(projectStatusLabel('Smoke', { needs: 0, working: 3 })).toBe('Smoke, working')
    expect(projectStatusLabel('Smoke', projectStatus(['done', 'idle']))).toBe('Smoke')
  })
})

describe('ordering from the displayed order', () => {
  const stored = [p('a'), p('b'), p('c'), p('d', true), p('e', true)]

  it('seeds the manual order from what the sidebar shows, pinned first', () => {
    expect(ids(seedOrder(stored, ['e', 'd', 'c', 'a', 'b']))).toEqual(['e', 'd', 'c', 'a', 'b'])
    expect(ids(seedOrder(stored, ['c', 'a', 'e', 'b', 'd']))).toEqual(['e', 'd', 'c', 'a', 'b'])
  })

  it('keeps projects the sidebar does not show after the shown ones in stored order', () => {
    expect(ids(seedOrder(stored, ['c', 'b']))).toEqual(['d', 'e', 'c', 'b', 'a'])
  })

  it('applies a drag on top of the displayed order, not the stored one', () => {
    expect(ids(reorderFromDisplay(stored, ['d', 'e', 'c', 'b', 'a'], 'a', 'c'))).toEqual(['d', 'e', 'a', 'c', 'b'])
  })

  it('does not let a drag cross between pinned and unpinned', () => {
    expect(ids(reorderFromDisplay(stored, ['d', 'e', 'c', 'b', 'a'], 'a', 'd'))).toEqual(['d', 'e', 'c', 'b', 'a'])
  })

  it('moves one step in the displayed order and stops at the group edge', () => {
    expect(ids(moveFromDisplay(stored, ['d', 'e', 'c', 'b', 'a'], 'a', -1))).toEqual(['d', 'e', 'c', 'a', 'b'])
    expect(ids(moveFromDisplay(stored, ['d', 'e', 'c', 'b', 'a'], 'c', -1))).toEqual(['d', 'e', 'c', 'b', 'a'])
    expect(ids(moveFromDisplay(stored, ['d', 'e', 'c', 'b', 'a'], 'e', -1))).toEqual(['e', 'd', 'c', 'b', 'a'])
  })
})
