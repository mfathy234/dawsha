import { describe, expect, it } from 'vitest'
import { EDITOR_FONT_MAX, EDITOR_FONT_MIN, PANEL_DEFAULT_HEIGHT, PANEL_MIN_HEIGHT, clampFontSize, clampPanelHeight, defaultLayout, parseLayout } from '../../src/shared/filesLayout'

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

describe('explorer visibility', () => {
  it('is open by default and remembers a hidden explorer', () => {
    expect(defaultLayout().explorer.open).toBe(true)
    expect(parseLayout({ explorer: { open: false } }).explorer.open).toBe(false)
    expect(parseLayout({ explorer: { open: 'no' } }).explorer.open).toBe(true)
  })
})

describe('editor prefs', () => {
  it('start at 13px with wrapping off', () => {
    expect(defaultLayout().editor).toEqual({ fontSize: 13, wrap: false })
  })
  it('keep a saved size and wrap, and clamp or repair the rest', () => {
    expect(parseLayout({ editor: { fontSize: 16, wrap: true } }).editor).toEqual({ fontSize: 16, wrap: true })
    expect(parseLayout({ editor: { fontSize: 99, wrap: 'yes' } }).editor).toEqual({ fontSize: EDITOR_FONT_MAX, wrap: false })
    expect(parseLayout({ editor: { fontSize: 2 } }).editor.fontSize).toBe(EDITOR_FONT_MIN)
    expect(parseLayout({ editor: { fontSize: 'big' } }).editor.fontSize).toBe(13)
  })
  it('round a fractional size', () => {
    expect(clampFontSize(13.6)).toBe(14)
    expect(clampFontSize(NaN)).toBe(13)
  })
})
