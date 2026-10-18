import { describe, expect, it } from 'vitest'
import { buildSheet, filterSheet, fixedEntries, sheetGroupFor } from '../../src/shared/shortcutSheet'

describe('shortcut sheet', () => {
  it('puts commands in the group their id belongs to', () => {
    expect(sheetGroupFor('session.new')).toBe('Sessions')
    expect(sheetGroupFor('pane.maximize')).toBe('Panes')
    expect(sheetGroupFor('terminal.copy-reply')).toBe('Terminal')
    expect(sheetGroupFor('pane.find')).toBe('Terminal')
    expect(sheetGroupFor('view.settings')).toBe('Views')
    expect(sheetGroupFor('dictation.toggle')).toBe('Dictation')
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
    expect(groups.map((g) => g.label)).toEqual(['Sessions', 'Panes', 'Terminal', 'General'])
    expect(groups[0].entries).toEqual([{ title: 'New session', keys: 'Ctrl+N' }])
    expect(groups.flatMap((g) => g.entries).some((e) => e.title === 'Show git diff')).toBe(false)
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
