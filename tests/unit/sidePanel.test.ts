import { describe, expect, it } from 'vitest'
import { migrateSettings } from '../../src/shared/settingsSchema'
import { clampSidePanelWidth, DEFAULT_SIDE_PANEL, fitSidePanelWidth, MAX_SIDE_PANEL_WIDTH, MIN_SIDE_PANEL_WIDTH, sanitizeSidePanel } from '../../src/shared/sidePanel'
import { isNoMove, dropSlot, slotToIndex } from '../../src/shared/tabDrag'
import { parsePlanLabel } from '../../src/shared/planProgress'
import { sideColumnOverflows } from '../../src/shared/gridStyle'

describe('side panel width', () => {
  it('keeps a width inside the limits and falls back for junk', () => {
    expect(clampSidePanelWidth(100)).toBe(MIN_SIDE_PANEL_WIDTH)
    expect(clampSidePanelWidth(5000)).toBe(MAX_SIDE_PANEL_WIDTH)
    expect(clampSidePanelWidth(401.6)).toBe(402)
    expect(clampSidePanelWidth('wide')).toBe(DEFAULT_SIDE_PANEL.width)
    expect(clampSidePanelWidth(Number.NaN)).toBe(DEFAULT_SIDE_PANEL.width)
  })

  it('narrows the panel on a small window so the session keeps its room', () => {
    expect(fitSidePanelWidth(500, 1400)).toBe(500)
    expect(fitSidePanelWidth(500, 800)).toBe(380)
    expect(fitSidePanelWidth(500, 500)).toBe(MIN_SIDE_PANEL_WIDTH)
  })
})

describe('side panel settings', () => {
  it('sanitizes saved values and defaults everything else', () => {
    expect(sanitizeSidePanel(undefined)).toEqual(DEFAULT_SIDE_PANEL)
    expect(sanitizeSidePanel({ open: false, width: 450, tab: 'plan' })).toEqual({ open: false, width: 450, tab: 'plan' })
    expect(sanitizeSidePanel({ open: 'no', width: 'x', tab: 'preview' })).toEqual(DEFAULT_SIDE_PANEL)
  })

  it('is part of the migrated settings', () => {
    expect(migrateSettings({}).sidePanel).toEqual(DEFAULT_SIDE_PANEL)
    expect(migrateSettings({ sidePanel: { width: 9999, tab: 'checks' } }).sidePanel).toEqual({ open: true, width: MAX_SIDE_PANEL_WIDTH, tab: 'checks' })
    expect(migrateSettings({ sessionsLayout: 'panel' }).sessionsLayout).toBe('panel')
  })
})

describe('tab drag', () => {
  const centers = [50, 150, 250]
  it('counts the tabs left of the pointer', () => {
    expect(dropSlot(centers, 10)).toBe(0)
    expect(dropSlot(centers, 100)).toBe(1)
    expect(dropSlot(centers, 200)).toBe(2)
    expect(dropSlot(centers, 900)).toBe(3)
    expect(dropSlot([], 10)).toBe(0)
  })

  it('turns a gap into the tab index after the move', () => {
    expect(slotToIndex(0, 3)).toBe(2)
    expect(slotToIndex(2, 0)).toBe(0)
    expect(slotToIndex(1, 1)).toBe(1)
    expect(slotToIndex(1, 2)).toBe(1)
  })

  it('knows the gaps beside the dragged tab leave it in place', () => {
    expect(isNoMove(1, 1)).toBe(true)
    expect(isNoMove(1, 2)).toBe(true)
    expect(isNoMove(1, 3)).toBe(false)
    expect(isNoMove(1, 0)).toBe(false)
  })
})

describe('plan label', () => {
  it('reads "3 of 7" as a count', () => {
    expect(parsePlanLabel('3 of 7')).toEqual({ done: 3, total: 7, percent: 43 })
    expect(parsePlanLabel('0 of 4')).toEqual({ done: 0, total: 4, percent: 0 })
  })

  it('refuses anything else', () => {
    expect(parsePlanLabel('')).toBeNull()
    expect(parsePlanLabel('3/7')).toBeNull()
    expect(parsePlanLabel('8 of 7')).toBeNull()
    expect(parsePlanLabel('1 of 0')).toBeNull()
  })
})

describe('calm focus side column', () => {
  it('scrolls once the side panes would be shorter than their minimum', () => {
    expect(sideColumnOverflows(0, 600, 12, 12)).toBe(false)
    expect(sideColumnOverflows(3, 700, 12, 12)).toBe(false)
    expect(sideColumnOverflows(5, 700, 12, 12)).toBe(true)
  })
})
