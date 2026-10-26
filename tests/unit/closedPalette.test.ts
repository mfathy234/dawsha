import { describe, expect, it } from 'vitest'
import { CLOSED_BROWSE_LIMIT, CLOSED_GROUP, closedPaletteItems } from '../../src/shared/closedPalette'
import { buildGroups } from '../../src/shared/palette'
import type { KeptSession } from '../../src/shared/types'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const HOUR = 3_600_000
const projects = [{ id: 'p1', name: 'billing-api' }, { id: 'p2', name: 'web' }]
const kept = (sessionId: string, hoursAgo: number, extra: Partial<KeptSession> = {}): KeptSession => ({
  projectId: 'p1', agent: 'claude', sessionId, title: `Session ${sessionId}`, closedAt: NOW - hoursAgo * HOUR, ...extra
})

describe('closedPaletteItems', () => {
  it('orders newest first and labels with project and age', () => {
    const items = closedPaletteItems([kept('a', 30), kept('b', 2, { projectId: 'p2', agent: 'codex' })], projects, new Set(), NOW)
    expect(items.map((i) => i.id)).toEqual(['closed:codex:b', 'closed:claude:a'])
    expect(items[0]).toMatchObject({ group: CLOSED_GROUP, hint: 'web · 2h', title: 'Session b' })
    expect(items[1].hint).toBe('billing-api · 1d')
  })

  it('leaves out open sessions, unknown projects and duplicates', () => {
    const items = closedPaletteItems(
      [kept('a', 1), kept('a', 5), kept('b', 2), kept('c', 3, { projectId: 'gone' })],
      projects,
      new Set(['claude:b']),
      NOW
    )
    expect(items.map((i) => i.session.sessionId)).toEqual(['a'])
  })

  it('shows only the newest few when browsing but finds all by typing', () => {
    const many = Array.from({ length: CLOSED_BROWSE_LIMIT + 3 }, (_, i) => kept(`s${i}`, i + 1))
    const items = closedPaletteItems(many, projects, new Set(), NOW)
    const browse = buildGroups(items, '', [])
    expect(browse[0].rows).toHaveLength(CLOSED_BROWSE_LIMIT)
    const typed = buildGroups(items, `s${CLOSED_BROWSE_LIMIT + 2}`, [])
    expect(typed[0].rows.map((r) => r.item.session.sessionId)).toContain(`s${CLOSED_BROWSE_LIMIT + 2}`)
  })

  it('matches on project name and agent through keywords', () => {
    const items = closedPaletteItems([kept('a', 1), kept('b', 2, { projectId: 'p2' })], projects, new Set(), NOW)
    const rows = buildGroups(items, 'web', [])[0].rows
    expect(rows.map((r) => r.item.session.sessionId)).toEqual(['b'])
  })
})
