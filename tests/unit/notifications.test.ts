import { describe, expect, it } from 'vitest'
import {
  MAX_NOTIFICATIONS,
  actionAvailable,
  addNotification,
  badgeText,
  bellLabel,
  consumeAction,
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
