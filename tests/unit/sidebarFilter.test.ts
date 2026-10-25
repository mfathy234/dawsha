import { describe, expect, it } from 'vitest'
import { filterSidebar } from '../../src/shared/sidebarFilter'
import type { KeptSession, Project } from '../../src/shared/types'

const project = (id: string, name: string): Project => ({ id, name, folder: `C:\\${id}`, defaultAgent: 'claude' })
const view = (title: string, projectId: string) => ({ title, pane: { projectId } })
const kept = (sessionId: string, title: string, projectId: string): KeptSession => ({ projectId, agent: 'claude', sessionId, title, closedAt: 1 })

const projects = [project('a', 'Alpha'), project('b', 'Beta'), project('c', 'Gamma')]
const views = [view('Fix login', 'a'), view('Dark mode', 'b'), view('Login page', 'c')]
const keptSessions = [kept('1', 'Old login bug', 'b'), kept('2', 'Refactor', 'a')]

const titles = (query: string) =>
  filterSidebar(projects, views, keptSessions, new Set(), query).map((e) => [e.project.id, e.views.map((v) => v.title), e.closed.map((s) => s.title)])

describe('sidebar filter', () => {
  it('shows everything for an empty or blank filter', () => {
    expect(titles('')).toHaveLength(3)
    expect(titles('   ')).toHaveLength(3)
    expect(titles('')[1]).toEqual(['b', ['Dark mode'], ['Old login bug']])
  })

  it('keeps all sessions of a project that matches by name', () => {
    expect(titles('alp')).toEqual([['a', ['Fix login'], ['Refactor']]])
  })

  it('lists only the matching open and closed sessions of a project that matches through them', () => {
    expect(titles(' LOGIN ')).toEqual([
      ['a', ['Fix login'], []],
      ['b', [], ['Old login bug']],
      ['c', ['Login page'], []]
    ])
  })

  it('shows a name match in full and drops projects with no match', () => {
    expect(titles('beta')).toEqual([['b', ['Dark mode'], ['Old login bug']]])
    expect(titles('zzz')).toEqual([])
  })

  it('puts name matches before session-only matches', () => {
    const list = [project('x', 'Docs'), project('y', 'Login service')]
    const entries = filterSidebar(list, [view('login notes', 'x')], [], new Set(), 'login')
    expect(entries.map((e) => e.project.id)).toEqual(['y', 'x'])
    expect(entries[1].views.map((v) => v.title)).toEqual(['login notes'])
  })

  it('leaves out closed sessions that are open again', () => {
    const entries = filterSidebar(projects, views, keptSessions, new Set(['claude:1']), 'login')
    expect(entries.map((e) => e.project.id)).toEqual(['a', 'c'])
  })
})
