import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE, DESKTOP_APP_STYLE, isDesktopAppStyle, sanitizeAppearance, sanitizeMiniWindow } from '../../src/shared/appearance'
import { defaultSettings, migrateSettings as sanitizeSettings } from '../../src/shared/settingsSchema'

describe('appearance settings', () => {
  it('starts everyone on Classic', () => {
    expect(defaultSettings().appearance).toEqual(DEFAULT_APPEARANCE)
    expect(sanitizeSettings({}).appearance).toEqual({ panes: 'classic', frame: 'topbar', tone: 'cool' })
  })

  it('keeps valid choices and drops unknown ones', () => {
    expect(sanitizeAppearance({ panes: 'quiet', frame: 'nope', tone: 'warm' })).toEqual({ panes: 'quiet', frame: 'topbar', tone: 'warm' })
    expect(sanitizeAppearance('quiet')).toEqual(DEFAULT_APPEARANCE)
  })

  it('knows the Desktop app style preset', () => {
    expect(isDesktopAppStyle(DESKTOP_APP_STYLE)).toBe(true)
    expect(isDesktopAppStyle({ ...DESKTOP_APP_STYLE, tone: 'cool' })).toBe(false)
  })

  it('accepts the Side panel sessions layout', () => {
    expect(sanitizeSettings({ sessionsLayout: 'panel' }).sessionsLayout).toBe('panel')
    expect(sanitizeSettings({ sessionsLayout: 'other' }).sessionsLayout).toBe('grid')
  })
})

describe('mini window settings', () => {
  it('defaults to closed on minimize, unfolded, no saved spot', () => {
    expect(sanitizeSettings({}).miniWindow).toEqual({ showOnMinimize: false, folded: false, bounds: null })
  })

  it('keeps whole-number bounds and drops broken ones', () => {
    expect(sanitizeMiniWindow({ showOnMinimize: true, bounds: { x: 10.4, y: 20, width: 360, height: 480 } })).toEqual({
      showOnMinimize: true,
      folded: false,
      bounds: { x: 10, y: 20, width: 360, height: 480 }
    })
    expect(sanitizeMiniWindow({ bounds: { x: 1, y: 2, width: 0, height: 480 } }).bounds).toBeNull()
    expect(sanitizeMiniWindow({ bounds: { x: 'a', y: 2, width: 3, height: 4 } }).bounds).toBeNull()
  })
})
