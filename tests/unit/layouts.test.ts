import { describe, expect, it } from 'vitest'
import {
  findLayout,
  layoutProjectNames,
  layoutSlug,
  openedText,
  paneAgent,
  planOpen,
  snapshotWorkspace,
  validateLayoutName,
  type SnapshotPane
} from '../../src/shared/layouts'
import { migrateSettings } from '../../src/shared/settingsSchema'
import type { SavedLayout } from '../../src/shared/types'

const pane = (id: string, projectId: string, tabs: SnapshotPane['tabs'], activeTabId?: string): SnapshotPane => ({
  id,
  projectId,
  fontSize: 16,
  activeTabId: activeTabId ?? tabs[0].id,
  tabs
})

const layout = (name: string, projects: string[], id = name): SavedLayout => ({
  id,
  name,
  createdAt: 1,
  focusedIndex: 0,
  panes: projects.map((projectId) => ({
    projectId,
    activeIndex: 0,
    fontSize: 15,
    tabs: [{ agent: 'claude', label: 'claude' }]
  }))
})

describe('snapshotWorkspace', () => {
  const panes = [
    pane('p1', 'a', [
      { id: 't1', agent: 'claude', label: 'claude', sessionId: 's-claude' },
      { id: 't2', agent: 'shell', label: 'shell', sessionId: 'ignored' },
      { id: 't3', agent: 'shell', label: 'update codex', task: {} }
    ], 't2'),
    pane('p2', 'b', [{ id: 't4', agent: 'codex', label: 'codex' }]),
    pane('p3', 'c', [{ id: 't5', agent: 'shell', label: 'task', task: {} }])
  ]

  it('keeps order, font sizes and the active tab, and drops task tabs and empty panes', () => {
    const result = snapshotWorkspace(panes, 'p2')
    expect(result.focusedIndex).toBe(1)
    expect(result.panes).toHaveLength(2)
    expect(result.panes[0]).toEqual({
      projectId: 'a',
      fontSize: 16,
      activeIndex: 1,
      tabs: [
        { agent: 'claude', label: 'claude', sessionId: 's-claude' },
        { agent: 'shell', label: 'shell', sessionId: undefined }
      ]
    })
    expect(result.panes[1].tabs[0]).toMatchObject({ agent: 'codex' })
  })

  it('saves the pinned flag, the splits and the reordered tab order with the active tab', () => {
    const reordered = [
      { ...panes[0], pinned: true, tabs: [panes[0].tabs[1], panes[0].tabs[0]] },
      panes[1]
    ]
    const result = snapshotWorkspace(reordered, 'p1', { splits: { '2x1': { cols: [1, 3], rows: [1] } } })
    expect(result.panes[0].pinned).toBe(true)
    expect(result.panes[1].pinned).toBeUndefined()
    expect(result.panes[0].tabs.map((tab) => tab.agent)).toEqual(['shell', 'claude'])
    expect(result.panes[0].activeIndex).toBe(0)
    expect(result.splits).toEqual({ '2x1': { cols: [0.25, 0.75], rows: [1] } })
  })

  it('leaves splits out when none are stored', () => {
    expect(snapshotWorkspace(panes, null).splits).toBeUndefined()
    expect(snapshotWorkspace(panes, null, { splits: {} }).splits).toBeUndefined()
  })

  it('lets the caller supply session ids such as ones matched from the agent folders', () => {
    const result = snapshotWorkspace(panes, null, { sessionFor: (tab) => tab.sessionId ?? `matched-${tab.id}` })
    expect(result.panes[1].tabs[0].sessionId).toBe('matched-t4')
    expect(result.panes[0].tabs[1].sessionId).toBeUndefined()
    expect(result.focusedIndex).toBe(0)
  })
})

describe('findLayout', () => {
  const layouts = [layout('Morning', ['a'], 'l1'), layout('Docs day', ['b'], 'l2')]

  it('matches by id, name ignoring case and by slug', () => {
    expect(findLayout(layouts, 'l2')?.name).toBe('Docs day')
    expect(findLayout(layouts, 'MORNING')?.name).toBe('Morning')
    expect(findLayout(layouts, 'docs-day')?.name).toBe('Docs day')
    expect(findLayout(layouts, '  docs day ')?.name).toBe('Docs day')
  })

  it('returns nothing for an empty or unknown query', () => {
    expect(findLayout(layouts, '')).toBeUndefined()
    expect(findLayout(layouts, '---')).toBeUndefined()
    expect(findLayout(layouts, 'evening')).toBeUndefined()
  })

  it('builds the terminal-friendly name', () => {
    expect(layoutSlug('Docs day!')).toBe('docs-day')
  })
})

describe('validateLayoutName', () => {
  const layouts = [layout('Morning', ['a'], 'l1')]

  it('rejects empty, long and duplicate names but allows the same layout to keep its name', () => {
    expect(validateLayoutName('   ', layouts)).toBe('Enter a name.')
    expect(validateLayoutName('x'.repeat(41), layouts)).toBe('Use at most 40 characters.')
    expect(validateLayoutName('morning', layouts)).toBe("A layout named 'Morning' already exists.")
    expect(validateLayoutName('morning', layouts, 'l1')).toBeNull()
    expect(validateLayoutName('Evening', layouts)).toBeNull()
  })

  it('stops at the layout limit when saving a new one', () => {
    const many = Array.from({ length: 50 }, (_, i) => layout(`L${i}`, ['a']))
    expect(validateLayoutName('One more', many)).toBe('You can keep at most 50 layouts.')
  })
})

describe('planOpen and openedText', () => {
  it('keeps panes whose project exists and reports the rest', () => {
    const saved = layout('Mixed', ['a', 'gone', 'b', 'gone'])
    const plan = planOpen(saved, [{ id: 'a' }, { id: 'b' }])
    expect(plan.openable.map((p) => p.projectId)).toEqual(['a', 'b'])
    expect(plan.missingProjects).toEqual(['gone'])
    expect(openedText(saved, plan)).toBe("Opened layout 'Mixed' (2 of 4 panes; 2 skipped because a project was removed)")
  })

  it('moves the focused index onto the remaining panes', () => {
    const saved = { ...layout('Focus', ['gone', 'a', 'b']), focusedIndex: 2 }
    expect(planOpen(saved, [{ id: 'a' }, { id: 'b' }]).focusedIndex).toBe(1)
    const lost = { ...layout('Lost', ['gone', 'a']), focusedIndex: 0 }
    expect(planOpen(lost, [{ id: 'a' }]).focusedIndex).toBe(0)
  })

  it('describes a full open and singular counts', () => {
    const saved = layout('Solo', ['a'])
    expect(openedText(saved, planOpen(saved, [{ id: 'a' }]))).toBe("Opened layout 'Solo' (1 pane)")
  })
})

describe('layoutProjectNames and paneAgent', () => {
  it('lists distinct project names and the first agent of a pane', () => {
    const saved = layout('X', ['a', 'b', 'a', 'gone'])
    expect(layoutProjectNames(saved, [{ id: 'a', name: 'acme-web' }, { id: 'b', name: 'billing-api' }])).toEqual([
      'acme-web',
      'billing-api',
      'removed project'
    ])
    expect(paneAgent({ projectId: 'a', activeIndex: 0, fontSize: 15, tabs: [{ agent: 'shell', label: 's' }, { agent: 'gemini', label: 'g' }] })).toBe('gemini')
    expect(paneAgent({ projectId: 'a', activeIndex: 0, fontSize: 15, tabs: [{ agent: 'shell', label: 's' }] })).toBe('shell')
  })
})

describe('layouts in settings', () => {
  it('restores saved panes and tabs while dropping retired agent metadata', () => {
    const tab = { agent: 'codex', label: 'Worker', sessionId: 'session-1', orchAgentId: 'old-agent' }
    const pane = { projectId: 'a', folder: 'C:/work/tree', orchAgentId: 'old-pane', tabs: [tab], activeIndex: 0, fontSize: 18 }
    const result = migrateSettings({
      projects: [{ id: 'a', folder: 'C:/work' }],
      workspace: { panes: [pane], focusedIndex: 0 },
      layouts: [{ id: 'saved', name: 'Saved', createdAt: 5, panes: [pane], focusedIndex: 0 }]
    })
    const clean = { projectId: 'a', folder: 'C:/work/tree', tabs: [{ agent: 'codex', label: 'Worker', sessionId: 'session-1' }], activeIndex: 0, fontSize: 18 }
    expect(result.workspace.panes).toEqual([clean])
    expect(result.layouts[0].panes).toEqual([clean])
    expect(planOpen(result.layouts[0], result.projects).openable).toEqual([clean])
  })

  it('keeps valid layouts even when a project was removed and drops broken ones', () => {
    const result = migrateSettings({
      projects: [{ id: 'a', name: 'acme-web', folder: 'C:\\acme-web' }],
      layouts: [
        {
          id: 'l1',
          name: ' Morning ',
          createdAt: 5,
          focusedIndex: 9,
          panes: [
            { projectId: 'a', activeIndex: 0, fontSize: 18, tabs: [{ agent: 'claude', label: 'claude', sessionId: 'abc' }] },
            { projectId: 'removed', activeIndex: 0, fontSize: 15, tabs: [{ agent: 'codex', label: 'codex' }] }
          ]
        },
        { id: 'l1', name: 'Duplicate id', panes: [{ projectId: 'a', tabs: [{ agent: 'shell', label: 'shell' }] }] },
        { id: 'l3', name: '', panes: [{ projectId: 'a', tabs: [{ agent: 'shell', label: 'shell' }] }] },
        { id: 'l4', name: 'Empty', panes: [] },
        'junk'
      ]
    })
    expect(result.layouts.map((l) => l.name)).toEqual(['Morning', 'Duplicate id'])
    expect(result.layouts[0]).toMatchObject({ id: 'l1', createdAt: 5, focusedIndex: 1 })
    expect(result.layouts[0].panes.map((p) => p.projectId)).toEqual(['a', 'removed'])
    expect(result.layouts[0].panes[0].tabs[0].sessionId).toBe('abc')
    expect(result.layouts[1].id).not.toBe('l1')
  })

  it('defaults to no layouts', () => {
    expect(migrateSettings({}).layouts).toEqual([])
    expect(migrateSettings({ layouts: 'x' }).layouts).toEqual([])
  })
})
