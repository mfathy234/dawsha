import { describe, expect, it } from 'vitest'
import { buildSheet, filterSheet, fixedEntries, sheetGroupFor } from '../../src/shared/shortcutSheet'

describe('shortcut sheet', () => {
  it('puts commands in the group their id belongs to', () => {
    expect(sheetGroupFor('session.new')).toBe('Sessions')
    expect(sheetGroupFor('pane.maximize')).toBe('Panes')
    expect(sheetGroupFor('terminal.copy-reply')).toBe('Terminal')
    expect(sheetGroupFor('pane.find')).toBe('Terminal')
    expect(sheetGroupFor('view.settings')).toBe('Views')
    expect(sheetGroupFor('something.else')).toBe('General')
  })

  it('lists only commands that have a shortcut, once, with the fixed keys', () => {
    const groups = buildSheet(
      [
        { id: 'session.new', title: 'New session', shortcut: 'Ctrl+N' },
        { id: 'session.new', title: 'New session', shortcut: 'Ctrl+N' },
        { id: 'pane.diff', title: 'Show git diff' }
      ],
      fixedEntries('Ctrl+K', 'Ctrl')
    )
    expect(groups.map((g) => g.label)).toEqual(['Sessions', 'Panes', 'Terminal', 'Views', 'General'])
    expect(groups[0].entries).toEqual([{ title: 'New session', keys: 'Ctrl+N' }])
    expect(groups.flatMap((g) => g.entries).some((e) => e.title === 'Show git diff')).toBe(false)
  })

  it('collapses Focus pane 1 to 9 into one row that still matches a single number', () => {
    const panes = Array.from({ length: 9 }, (_, i) => ({ id: `pane.focus-${i + 1}`, title: `Focus pane ${i + 1}`, shortcut: `Ctrl+${i + 1}` }))
    const groups = buildSheet([{ id: 'pane.maximize', title: 'Expand the pane', shortcut: 'Ctrl+Enter' }, ...panes], [])
    expect(groups[0].entries.map((e) => [e.title, e.keys])).toEqual([['Expand the pane', 'Ctrl+Enter'], ['Focus pane 1–9', 'Ctrl+1…9']])
    expect(filterSheet(groups, 'focus pane 3').flatMap((g) => g.entries.map((e) => e.title))).toEqual(['Focus pane 1–9'])
    expect(filterSheet(groups, 'ctrl+3').flatMap((g) => g.entries.map((e) => e.title))).toEqual(['Focus pane 1–9'])
  })

  it('filters by words in the title, the keys or the group name', () => {
    const groups = buildSheet(
      [
        { id: 'session.new', title: 'New session', shortcut: 'Ctrl+N' },
        { id: 'pane.maximize', title: 'Expand the pane', shortcut: 'Ctrl+Enter' }
      ],
      []
    )
    expect(filterSheet(groups, 'expand').flatMap((g) => g.entries.map((e) => e.title))).toEqual(['Expand the pane'])
    expect(filterSheet(groups, 'ctrl+n').flatMap((g) => g.entries.length)).toEqual([1])
    expect(filterSheet(groups, 'sessions new').map((g) => g.label)).toEqual(['Sessions'])
    expect(filterSheet(groups, 'nothing here')).toEqual([])
    expect(filterSheet(groups, '  ')).toBe(groups)
  })
})
