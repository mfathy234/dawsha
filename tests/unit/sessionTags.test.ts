import { describe, expect, it } from 'vitest'
import { closedUsageShort, closedUsageTooltip, renameKept, reopenGroupLabel, tagKept } from '../../src/shared/keptSessions'
import { moveProjectTo, canDropProject } from '../../src/shared/projectOrder'
import { cleanSessionName, isSessionTag, SESSION_NAME_MAX } from '../../src/shared/sessionTags'
import { migrateSettings } from '../../src/shared/settingsSchema'
import { snapshotWorkspace } from '../../src/shared/layouts'
import type { KeptSession, Project } from '../../src/shared/types'

const p = (id: string, pinned = false): Project => ({ id, name: id, folder: `/${id}`, defaultAgent: 'claude', ...(pinned ? { pinned: true } : {}) })
const ids = (projects: Project[]): string[] => projects.map((x) => x.id)
const kept = (sessionId: string, extra: Partial<KeptSession> = {}): KeptSession => ({ projectId: 'api', agent: 'claude', sessionId, title: sessionId, closedAt: 1, ...extra })

describe('moveProjectTo', () => {
  const list = [p('a'), p('b'), p('c'), p('d')]
  it('takes the place of the target, moving down and up', () => {
    expect(ids(moveProjectTo(list, 'a', 'c'))).toEqual(['b', 'c', 'a', 'd'])
    expect(ids(moveProjectTo(list, 'd', 'b'))).toEqual(['a', 'd', 'b', 'c'])
    expect(ids(list)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('keeps pinned and unpinned apart and ignores unknown or identical ids', () => {
    const mixed = [p('a'), p('b', true), p('c'), p('d', true)]
    expect(ids(moveProjectTo(mixed, 'a', 'b'))).toEqual(['a', 'b', 'c', 'd'])
    expect(canDropProject(mixed, 'a', 'b')).toBe(false)
    expect(ids(moveProjectTo(mixed, 'b', 'd'))).toEqual(['a', 'c', 'd', 'b'])
    expect(canDropProject(mixed, 'b', 'd')).toBe(true)
    expect(ids(moveProjectTo(list, 'a', 'a'))).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(moveProjectTo(list, 'a', 'zzz'))).toEqual(['a', 'b', 'c', 'd'])
    expect(canDropProject(list, 'a', 'a')).toBe(false)
  })
})

describe('session names and tags', () => {
  it('trims names, caps them and treats an empty one as a cancel', () => {
    expect(cleanSessionName('  Fix   login \n')).toBe('Fix login')
    expect(cleanSessionName('   ')).toBeNull()
    expect(cleanSessionName('x'.repeat(500))).toHaveLength(SESSION_NAME_MAX)
    expect(cleanSessionName('عنوان الجلسة')).toBe('عنوان الجلسة')
  })
  it('knows the fixed set of tags', () => {
    expect(isSessionTag('bug')).toBe(true)
    expect(isSessionTag('urgent')).toBe(false)
    expect(isSessionTag(undefined)).toBe(false)
  })
  it('renames and tags only the matching closed session, without touching the list', () => {
    const list = [kept('one'), kept('two')]
    const renamed = renameKept(list, { agent: 'claude', sessionId: 'two' }, '  New name ')
    expect(renamed.map((s) => [s.title, s.renamed])).toEqual([['one', undefined], ['New name', true]])
    expect(renameKept(list, { agent: 'claude', sessionId: 'two' }, '  ')).toEqual(list)
    const tagged = tagKept(list, { agent: 'claude', sessionId: 'one' }, 'bug')
    expect(tagged[0].tag).toBe('bug')
    expect(tagged[1].tag).toBeUndefined()
    expect('tag' in tagKept(tagged, { agent: 'claude', sessionId: 'one' }, null)[0]).toBe(false)
    expect(list[0].tag).toBeUndefined()
  })
})

describe('closed session usage and reopen labels', () => {
  it('shows dollars when known, tokens otherwise, nothing when empty', () => {
    expect(closedUsageShort({ tokens: 1_500_000, costUsd: 0.4231 })).toBe('$0.42')
    expect(closedUsageShort({ tokens: 12_300, costUsd: null })).toBe('12K')
    expect(closedUsageShort({ tokens: 0, costUsd: null })).toBeNull()
    expect(closedUsageShort(undefined)).toBeNull()
    expect(closedUsageTooltip({ tokens: 12_300, costUsd: 1 })).toBe('$1.00 · 12K tokens')
    expect(closedUsageTooltip(undefined)).toBe('')
  })
  it('names the group, count and project', () => {
    expect(reopenGroupLabel(3, 'Today', 'Smoke')).toBe('Reopen 3 sessions from Today in Smoke')
    expect(reopenGroupLabel(1, 'Earlier', 'Smoke')).toBe('Reopen 1 session from Earlier in Smoke')
  })
})

describe('tags in settings', () => {
  const projects = [{ id: 'api', name: 'API', folder: '/api', defaultAgent: 'claude' }]
  it('keeps a valid tag and a name on closed sessions and saved tabs, drops anything else', () => {
    const migrated = migrateSettings({
      projects,
      keptSessions: [
        { projectId: 'api', agent: 'claude', sessionId: 'a', title: 'A', closedAt: 1, tag: 'review', renamed: true },
        { projectId: 'api', agent: 'claude', sessionId: 'b', title: 'B', closedAt: 1, tag: 'nope', renamed: 'yes' }
      ],
      workspace: { focusedIndex: 0, panes: [{ projectId: 'api', fontSize: 14, activeIndex: 0, tabs: [
        { agent: 'claude', label: 'claude', name: '  My name ', tag: 'docs' },
        { agent: 'shell', label: 'shell', name: 'x', tag: 'bug' },
        { agent: 'claude', label: 'claude', name: '   ', tag: 'zzz' }
      ] }] }
    })
    expect(migrated.keptSessions[0]).toMatchObject({ tag: 'review', renamed: true })
    expect(migrated.keptSessions[1].tag).toBeUndefined()
    expect(migrated.keptSessions[1].renamed).toBeUndefined()
    const tabs = migrated.workspace.panes[0].tabs
    expect(tabs[0]).toMatchObject({ name: 'My name', tag: 'docs' })
    expect(tabs[1].name).toBeUndefined()
    expect(tabs[1].tag).toBeUndefined()
    expect(tabs[2].name).toBeUndefined()
    expect(tabs[2].tag).toBeUndefined()
  })
  it('saves a tab name and tag with the workspace', () => {
    const workspace = snapshotWorkspace([{ id: 'p', projectId: 'api', fontSize: 14, activeTabId: 't', tabs: [{ id: 't', agent: 'claude', label: 'claude', name: 'Mine', tag: 'bug' }] }], 'p')
    expect(workspace.panes[0].tabs[0]).toMatchObject({ name: 'Mine', tag: 'bug' })
  })
})
