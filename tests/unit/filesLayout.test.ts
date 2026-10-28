import { describe, expect, it } from 'vitest'
import { PANEL_DEFAULT_HEIGHT, PANEL_MIN_HEIGHT, clampPanelHeight, defaultLayout, parseLayout } from '../../src/shared/filesLayout'

describe('parseLayout', () => {
  it('falls back to the default for anything that is not a layout', () => {
    for (const bad of [null, undefined, 5, 'x', []]) expect(parseLayout(bad)).toEqual(defaultLayout())
  })
  it('keeps what is valid and repairs what is not', () => {
    const layout = parseLayout({ sections: { changes: false, open: 'no' }, inspector: { open: false, tab: 'activity' }, panel: { minimised: false, height: 99999 } })
    expect(layout.sections).toEqual({ changes: false, open: true, tree: true })
    expect(layout.inspector).toEqual({ open: false, tab: 'activity' })
    expect(layout.panel).toEqual({ minimised: false, height: 2000 })
  })
  it('turns an unknown inspector tab into Outline and a bad height into the default', () => {
    const layout = parseLayout({ inspector: { tab: 'x' }, panel: { height: 'tall' } })
    expect(layout.inspector.tab).toBe('outline')
    expect(layout.panel.height).toBe(PANEL_DEFAULT_HEIGHT)
  })
})

describe('clampPanelHeight', () => {
  it('stays between the minimum and most of the available space', () => {
    expect(clampPanelHeight(10, 600)).toBe(PANEL_MIN_HEIGHT)
    expect(clampPanelHeight(500, 600)).toBe(420)
    expect(clampPanelHeight(200, 600)).toBe(200)
    expect(clampPanelHeight(NaN, 600)).toBe(PANEL_DEFAULT_HEIGHT)
    expect(clampPanelHeight(300, 50)).toBe(PANEL_MIN_HEIGHT)
  })
})
