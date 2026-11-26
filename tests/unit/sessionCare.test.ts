import { describe, expect, it } from 'vitest'
import { migrateSettings } from '../../src/shared/settingsSchema'
import { snapshotWorkspace } from '../../src/shared/layouts'
import { HOUR_MS, NOTE_MAX, noteLine, sanitizeCare, shouldWake, snoozeFor, tomorrowMorning, withCare } from '../../src/shared/sessionCare'

describe('session care', () => {
  it('keeps only well-formed parts and drops an empty result', () => {
    expect(sanitizeCare(undefined)).toBeUndefined()
    expect(sanitizeCare({})).toBeUndefined()
    expect(sanitizeCare({ unread: 1, note: { text: '   ' }, snooze: { kind: 'nope' }, rule: { commandIds: [] } })).toBeUndefined()
    const care = sanitizeCare({ unread: true, note: { text: ` ${'x'.repeat(NOTE_MAX + 20)} `, at: 5 }, snooze: { kind: 'time', until: 9 }, rule: { commandIds: ['a', 'a', 'b', 4], tries: 99, onPass: 'commit' } })
    expect(care?.unread).toBe(true)
    expect(care?.note?.text).toHaveLength(NOTE_MAX)
    expect(care?.snooze).toEqual({ kind: 'time', until: 9, label: '' })
    expect(care?.rule).toEqual({ commandIds: ['a', 'b'], tries: 10, onPass: 'commit' })
  })

  it('refuses a timed snooze with no end', () => {
    expect(sanitizeCare({ snooze: { kind: 'time' } })).toBeUndefined()
    expect(sanitizeCare({ snooze: { kind: 'needs', until: 4 } })?.snooze?.until).toBeNull()
  })

  it('merges a patch and removes keys set to undefined', () => {
    const care = withCare(undefined, { unread: true })
    expect(care).toEqual({ unread: true })
    expect(withCare(care, { note: { text: 'a', at: 1 } })).toEqual({ unread: true, note: { text: 'a', at: 1 } })
    expect(withCare(care, { unread: undefined })).toBeUndefined()
  })

  it('snoozes for an hour, until the next 9:00, or on a condition', () => {
    const now = new Date(2026, 10, 26, 22, 30).getTime()
    expect(snoozeFor('hour', now)).toMatchObject({ kind: 'time', until: now + HOUR_MS })
    expect(snoozeFor('tomorrow', now).until).toBe(new Date(2026, 10, 27, 9, 0).getTime())
    expect(tomorrowMorning(new Date(2026, 10, 26, 6, 0).getTime())).toBe(new Date(2026, 10, 27, 9, 0).getTime())
    expect(snoozeFor('checks', now)).toMatchObject({ kind: 'checks', until: null })
    expect(snoozeFor('needs', now)).toMatchObject({ kind: 'needs', until: null })
  })

  it('wakes on time, on finished checks, never early, and always when the session needs the owner', () => {
    const timed = snoozeFor('hour', 1000)
    expect(shouldWake(timed, { now: 1000 + HOUR_MS - 1, needs: false, checksPending: null })).toBe(false)
    expect(shouldWake(timed, { now: 1000 + HOUR_MS, needs: false, checksPending: null })).toBe(true)
    expect(shouldWake(timed, { now: 1001, needs: true, checksPending: null })).toBe(true)
    const checks = snoozeFor('checks', 0)
    expect(shouldWake(checks, { now: 1, needs: false, checksPending: true })).toBe(false)
    expect(shouldWake(checks, { now: 1, needs: false, checksPending: false })).toBe(true)
    const needs = snoozeFor('needs', 0)
    expect(shouldWake(needs, { now: HOUR_MS * 99, needs: false, checksPending: false })).toBe(false)
  })

  it('writes a note as a Next line', () => {
    expect(noteLine(undefined)).toBe('')
    expect(noteLine({ text: 'test on stage', at: 0 })).toBe('Next: test on stage')
  })

  it('is kept in the saved workspace and read back, but not in a portable layout', () => {
    const pane = { id: 'p1', projectId: 'proj', fontSize: 14, activeTabId: 't1', care: { unread: true as const, note: { text: 'next', at: 3 } }, tabs: [{ id: 't1', agent: 'claude' as const, label: 'claude' }] }
    const saved = snapshotWorkspace([pane], 'p1')
    expect(saved.panes[0].care).toEqual(pane.care)
    expect(snapshotWorkspace([pane], 'p1', { portable: true }).panes[0].care).toBeUndefined()
    const project = { id: 'proj', name: 'Proj', folder: 'C:/proj', defaultAgent: 'claude' }
    const settings = migrateSettings({ projects: [project], workspace: JSON.parse(JSON.stringify(saved)) })
    expect(settings.workspace.panes[0].care).toEqual(pane.care)
  })
})
