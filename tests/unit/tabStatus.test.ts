import { describe, expect, it } from 'vitest'
import { showsTabPlan, tabNameStrong, tabStatus } from '../../src/shared/tabStatus'
import { overflowOrder, tabsOutOfView } from '../../src/shared/tabOverflow'

const NOW = 1_791_451_700_000
const MIN = 60_000

describe('tabStatus', () => {
  it('shows how long ago an idle tab was last active, muted', () => {
    expect(tabStatus('idle', NOW - 12 * MIN, NOW, false)).toEqual({ text: '12m', quiet: true })
    expect(tabStatus('idle', NOW - 3 * 60 * MIN, NOW, false)).toEqual({ text: '3h', quiet: true })
  })
  it('says nothing on an idle tab that is open', () => {
    expect(tabStatus('idle', NOW - 12 * MIN, NOW, true).text).toBe('')
  })
  it('keeps the word for working, needs you, done and exited', () => {
    expect(tabStatus('working', NOW, NOW, false)).toEqual({ text: 'Working', quiet: false })
    expect(tabStatus('needs', NOW, NOW, true)).toEqual({ text: 'Needs you', quiet: false })
    expect(tabStatus('done', NOW, NOW, false).text).toBe('Done')
    expect(tabStatus('exited', NOW, NOW, false).text).toBe('Exited')
  })
})

describe('showsTabPlan', () => {
  it('shows plan progress on a working tab and on the open tab, never without a plan', () => {
    expect(showsTabPlan('working', false, true)).toBe(true)
    expect(showsTabPlan('idle', true, true)).toBe(true)
    expect(showsTabPlan('idle', false, true)).toBe(false)
    expect(showsTabPlan('working', true, false)).toBe(false)
  })
})

describe('tabNameStrong', () => {
  it('brightens the name only for a done tab that is unread', () => {
    expect(tabNameStrong('done', true)).toBe(true)
    expect(tabNameStrong('done', false)).toBe(false)
    expect(tabNameStrong('working', true)).toBe(false)
  })
})

describe('tab overflow', () => {
  const spans = [{ id: 'a', start: 0, end: 100 }, { id: 'b', start: 102, end: 202 }, { id: 'c', start: 204, end: 304 }, { id: 'd', start: 306, end: 406 }]
  it('lists tabs that are not fully visible', () => {
    expect(tabsOutOfView(spans, 0, 250)).toEqual(['c', 'd'])
    expect(tabsOutOfView(spans, 150, 420)).toEqual(['a', 'b'])
    expect(tabsOutOfView(spans, 0, 500)).toEqual([])
  })
  it('puts tabs that need you first in the menu and keeps the rest in strip order', () => {
    const items = [{ id: 1, state: 'idle' as const }, { id: 2, state: 'needs' as const }, { id: 3, state: 'working' as const }, { id: 4, state: 'needs' as const }]
    expect(overflowOrder(items).map((item) => item.id)).toEqual([2, 4, 1, 3])
  })
})
