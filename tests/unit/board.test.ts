import { describe, expect, it } from 'vitest'
import {
  BOARD_COLUMNS,
  NO_BOARD_FILTER,
  boardColumn,
  canDropOn,
  filterMenuOptions,
  groupByColumn,
  isSessionsLayout,
  matchesBoardFilter,
  stepIndex
} from '../../src/shared/board'
import { sessionState } from '../../src/shared/sessionState'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'

describe('boardColumn', () => {
  it('maps each session state to a column', () => {
    expect(boardColumn('needs')).toBe('needs')
    expect(boardColumn('working')).toBe('working')
    expect(boardColumn('done')).toBe('done')
    expect(boardColumn('idle')).toBe('reviewed')
    expect(boardColumn('exited')).toBe('reviewed')
  })

  it('follows the session state model: a seen done session becomes idle and moves to Reviewed', () => {
    expect(boardColumn(sessionState({ status: 'idle', attention: 'done' }))).toBe('done')
    expect(boardColumn(sessionState({ status: 'idle', attention: 'none' }))).toBe('reviewed')
    expect(boardColumn(sessionState({ status: 'busy', attention: 'needs' }))).toBe('needs')
    expect(boardColumn(sessionState({ status: 'exited', attention: 'none' }))).toBe('reviewed')
  })

  it('lists the four columns in board order', () => {
    expect(BOARD_COLUMNS.map((column) => column.id)).toEqual(['needs', 'working', 'done', 'reviewed'])
  })
})

describe('groupByColumn', () => {
  it('groups entries and keeps their order inside a column', () => {
    const groups = groupByColumn([
      { id: 'a', state: 'working' as const },
      { id: 'b', state: 'idle' as const },
      { id: 'c', state: 'working' as const },
      { id: 'd', state: 'exited' as const },
      { id: 'e', state: 'needs' as const }
    ])
    expect(groups.working.map((e) => e.id)).toEqual(['a', 'c'])
    expect(groups.reviewed.map((e) => e.id)).toEqual(['b', 'd'])
    expect(groups.needs.map((e) => e.id)).toEqual(['e'])
    expect(groups.done).toEqual([])
  })
})

describe('matchesBoardFilter', () => {
  const entry = { projectId: 'p1', agent: 'claude' as const }

  it('matches everything without a filter', () => {
    expect(matchesBoardFilter(entry, NO_BOARD_FILTER)).toBe(true)
  })

  it('filters by project, agent and both', () => {
    expect(matchesBoardFilter(entry, { projectId: 'p1', agent: null })).toBe(true)
    expect(matchesBoardFilter(entry, { projectId: 'p2', agent: null })).toBe(false)
    expect(matchesBoardFilter(entry, { projectId: null, agent: 'claude' })).toBe(true)
    expect(matchesBoardFilter(entry, { projectId: null, agent: 'codex' })).toBe(false)
    expect(matchesBoardFilter(entry, { projectId: 'p1', agent: 'codex' })).toBe(false)
  })

  it('never matches a shell pane when an agent is chosen', () => {
    expect(matchesBoardFilter({ projectId: 'p1', agent: 'shell' }, { projectId: null, agent: 'claude' })).toBe(false)
  })
})

describe('canDropOn', () => {
  it('only lets a Done card move to Reviewed', () => {
    expect(canDropOn('done', 'reviewed')).toBe(true)
    expect(canDropOn('done', 'working')).toBe(false)
    expect(canDropOn('working', 'reviewed')).toBe(false)
    expect(canDropOn('needs', 'reviewed')).toBe(false)
    expect(canDropOn('reviewed', 'reviewed')).toBe(false)
  })
})

describe('stepIndex', () => {
  it('moves and stays inside the list', () => {
    expect(stepIndex(0, 1, 3)).toBe(1)
    expect(stepIndex(2, 1, 3)).toBe(2)
    expect(stepIndex(0, -1, 3)).toBe(0)
  })

  it('starts at either end when nothing is current, and handles an empty list', () => {
    expect(stepIndex(-1, 1, 3)).toBe(0)
    expect(stepIndex(-1, -1, 3)).toBe(2)
    expect(stepIndex(0, 1, 0)).toBe(-1)
  })
})

describe('filterMenuOptions', () => {
  const options = [
    { value: '', label: 'All projects' },
    { value: 'a', label: 'billing-api' },
    { value: 'b', label: 'Mobile shell' }
  ]

  it('returns every option for an empty query', () => {
    expect(filterMenuOptions(options, '  ')).toHaveLength(3)
  })

  it('matches case-insensitively on every typed word', () => {
    expect(filterMenuOptions(options, 'BILL').map((o) => o.value)).toEqual(['a'])
    expect(filterMenuOptions(options, 'shell mob').map((o) => o.value)).toEqual(['b'])
    expect(filterMenuOptions(options, 'zzz')).toEqual([])
  })
})

describe('sessions layout setting', () => {
  it('defaults to the grid and keeps a saved board', () => {
    expect(defaultSettings().sessionsLayout).toBe('grid')
    expect(migrateSettings({ sessionsLayout: 'board' }).sessionsLayout).toBe('board')
  })

  it('falls back to the grid for anything else', () => {
    expect(migrateSettings({ sessionsLayout: 'kanban' }).sessionsLayout).toBe('grid')
    expect(migrateSettings({}).sessionsLayout).toBe('grid')
    expect(isSessionsLayout(3)).toBe(false)
  })
})
