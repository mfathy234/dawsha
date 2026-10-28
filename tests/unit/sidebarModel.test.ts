import { describe, expect, it } from 'vitest'
import { hideEmptyProjects, isFolded, monogram, projectSummary, railBadge, sessionAge, sessionStatusLine, sortProjects, waitingOnYou } from '../../src/shared/sidebarModel'
import type { Project } from '../../src/shared/types'

const project = (id: string, name: string, pinned = false): Project => ({ id, name, folder: `/x/${id}`, defaultAgent: 'claude', ...(pinned ? { pinned: true } : {}) })
const NOW = 1_791_451_700_000
const MIN = 60_000

describe('sortProjects', () => {
  const projects = [project('b', 'Beta'), project('a', 'alpha'), project('c', 'Gamma', true), project('d', 'Delta')]
  it('keeps the stored order for manual, pinned first', () => {
    expect(sortProjects(projects, 'manual', {}).map((p) => p.id)).toEqual(['c', 'b', 'a', 'd'])
  })
  it('sorts by name without caring about case, pinned first', () => {
    expect(sortProjects(projects, 'name', {}).map((p) => p.id)).toEqual(['c', 'a', 'b', 'd'])
  })
  it('sorts by recent activity and keeps the stored order for ties', () => {
    expect(sortProjects(projects, 'recent', { d: 50, a: 10 }).map((p) => p.id)).toEqual(['c', 'd', 'a', 'b'])
  })
  it('does not change the input list', () => {
    const copy = [...projects]
    sortProjects(projects, 'name', {})
    expect(projects).toEqual(copy)
  })
})

describe('hideEmptyProjects', () => {
  const entries = [{ id: 1, views: [1], closed: [] }, { id: 2, views: [], closed: [] }, { id: 3, views: [], closed: [1] }]
  it('drops projects without any session only when asked', () => {
    expect(hideEmptyProjects(entries, true).map((e) => e.id)).toEqual([1, 3])
    expect(hideEmptyProjects(entries, false)).toHaveLength(3)
  })
})

describe('waitingOnYou', () => {
  it('lists only sessions that need you, newest first', () => {
    const items = [
      { id: 'a', state: 'needs' as const, at: 10 },
      { id: 'b', state: 'working' as const, at: 99 },
      { id: 'c', state: 'needs' as const, at: 30 },
      { id: 'd', state: 'done' as const, at: 50 }
    ]
    expect(waitingOnYou(items).map((i) => i.id)).toEqual(['c', 'a'])
    expect(waitingOnYou([])).toEqual([])
  })
})

describe('rows', () => {
  it('words the project summary', () => {
    expect(projectSummary(['working', 'idle', 'exited'])).toEqual({ text: '2 live', tone: 'live' })
    expect(projectSummary(['working', 'needs'])).toEqual({ text: 'needs you', tone: 'needs' })
    expect(projectSummary([])).toEqual({ text: '', tone: 'none' })
  })
  it('words the session status line', () => {
    expect(sessionStatusLine('working', 3)).toBe('Working · 3 agents')
    expect(sessionStatusLine('working', 1)).toBe('Working · 1 agent')
    expect(sessionStatusLine('idle', 2)).toBe('Idle')
    expect(sessionStatusLine('needs', 0)).toBe('Needs you')
  })
  it('words the age', () => {
    expect(sessionAge(NOW - 20_000, NOW)).toBe('now')
    expect(sessionAge(NOW - 4 * MIN, NOW)).toBe('4m')
    expect(sessionAge(NOW - 61 * MIN, NOW)).toBe('1h')
    expect(sessionAge(NOW - 30 * 60 * MIN, NOW)).toBe('yesterday')
    expect(sessionAge(NOW - 3 * 24 * 60 * MIN, NOW)).toBe('3d')
  })
  it('makes monograms and rail badges', () => {
    expect(monogram('acme-web')).toBe('AW')
    expect(monogram('Smoke')).toBe('SM')
    expect(monogram('  ')).toBe('?')
    expect(railBadge(['working', 'needs'])).toBe('!')
    expect(railBadge(['working', 'working', 'idle'])).toBe('2')
    expect(railBadge(['idle'])).toBe('')
  })
  it('unfolds everything while filtering', () => {
    expect(isFolded(['a'], 'a', false)).toBe(true)
    expect(isFolded(['a'], 'a', true)).toBe(false)
  })
})
