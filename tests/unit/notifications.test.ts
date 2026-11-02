import { describe, expect, it } from 'vitest'
import {
  MAX_NOTIFICATIONS,
  actionAvailable,
  addNotification,
  badgeText,
  bellLabel,
  clearSummary,
  consumeAction,
  groupNotifications,
  markAllRead,
  needsMessage,
  newlyNeeding,
  unreadCount,
  type NotificationEntry
} from '../../src/shared/notifications'

const entry = (id: number, extra: Partial<NotificationEntry> = {}): NotificationEntry => ({ id, message: `m${id}`, kind: 'info', at: id, read: false, ...extra })

describe('notification history', () => {
  it('keeps the newest first and drops the oldest past the cap', () => {
    let list: NotificationEntry[] = []
    for (let id = 1; id <= MAX_NOTIFICATIONS + 5; id += 1) list = addNotification(list, entry(id))
    expect(list).toHaveLength(MAX_NOTIFICATIONS)
    expect(list[0].id).toBe(MAX_NOTIFICATIONS + 5)
    expect(list[list.length - 1].id).toBe(6)
  })

  it('does not change the list it was given', () => {
    const list = Object.freeze([entry(1)])
    expect(addNotification(list, entry(2)).map((e) => e.id)).toEqual([2, 1])
    expect(list).toHaveLength(1)
  })

  it('counts unread and marks everything read, returning the same list when nothing changes', () => {
    const list = [entry(2), entry(1, { read: true })]
    expect(unreadCount(list)).toBe(1)
    const read = markAllRead(list)
    expect(unreadCount(read)).toBe(0)
    expect(list[0].read).toBe(false)
    expect(markAllRead(read)).toBe(read)
  })

  it('consumes an action once and leaves other entries alone', () => {
    const action = { label: 'Undo', run: () => undefined }
    const list = [entry(2, { action }), entry(1, { action })]
    const next = consumeAction(list, 2)
    expect(next[0].action).toBeUndefined()
    expect(next[1].action).toBe(action)
    expect(list[0].action).toBe(action)
  })

  it('treats an action as available unless it says otherwise', () => {
    const run = () => undefined
    expect(actionAvailable(entry(1))).toBe(false)
    expect(actionAvailable(entry(1, { action: { label: 'Undo', run } }))).toBe(true)
    expect(actionAvailable(entry(1, { action: { label: 'Go', run, valid: () => false } }))).toBe(false)
  })

  it('finds only the sessions that just started needing the user', () => {
    expect(newlyNeeding(new Set(['a']), ['a', 'b'])).toEqual(['b'])
    expect(newlyNeeding(new Set(), [])).toEqual([])
  })

  it('words the needs entry, the badge and the bell label', () => {
    expect(needsMessage('Fix login', 'Smoke')).toBe('Fix login in Smoke needs you')
    expect(needsMessage('Fix login', null)).toBe('Fix login needs you')
    expect(badgeText(3)).toBe('3')
    expect(badgeText(12)).toBe('9+')
    expect(bellLabel(0)).toBe('Notifications')
    expect(bellLabel(2)).toBe('Notifications, 2 unread')
  })
})

describe('notification groups', () => {
  it('groups by project, newest group and newest entry first, with General for the rest', () => {
    const list = [
      entry(1, { group: 'Smoke', at: 10 }),
      entry(2, { at: 20 }),
      entry(3, { group: 'Smoke', at: 30, read: true }),
      entry(4, { group: 'Other', at: 5 })
    ]
    const groups = groupNotifications(list)
    expect(groups.map((group) => group.name)).toEqual(['Smoke', 'General', 'Other'])
    expect(groups[0].entries.map((e) => e.id)).toEqual([3, 1])
    expect(groups[0].unread).toBe(1)
  })

  it('does not change the list it was given', () => {
    const list = Object.freeze([entry(1, { at: 1 }), entry(2, { at: 2 })])
    groupNotifications(list)
    expect(list.map((e) => e.id)).toEqual([1, 2])
  })

  it('names what Clear all removes', () => {
    expect(clearSummary([entry(1)])).toBe('1 notification')
    expect(clearSummary([entry(1, { group: 'Smoke' }), entry(2), entry(3)])).toBe('3 notifications (General 2, Smoke 1)')
    expect(clearSummary([entry(1), entry(2)])).toBe('2 notifications')
  })
})
