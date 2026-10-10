import { describe, expect, it } from 'vitest'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'
import {
  detectUpdateMode,
  formatAgo,
  initialUpdateState,
  pillLabel,
  showUpdatePill,
  updateStatusLine,
  type UpdateState
} from '../../src/shared/updates'

const state = (change: Partial<UpdateState>): UpdateState => ({ ...initialUpdateState('0.4.0', 'installed'), ...change })

describe('detectUpdateMode', () => {
  it('is portable whenever electron-builder sets the portable directory', () => {
    expect(detectUpdateMode({ packaged: true, portableDir: 'C:\\Temp\\x', fake: false })).toBe('portable')
  })

  it('is development when unpackaged', () => {
    expect(detectUpdateMode({ packaged: false, portableDir: undefined, fake: false })).toBe('dev')
  })

  it('is installed for a packaged build and for the test updater', () => {
    expect(detectUpdateMode({ packaged: true, portableDir: undefined, fake: false })).toBe('installed')
    expect(detectUpdateMode({ packaged: false, portableDir: undefined, fake: true })).toBe('installed')
  })
})

describe('update pill', () => {
  it('labels every state', () => {
    expect(pillLabel(state({ status: 'available', version: '0.5.0' }))).toBe('Update 0.5.0')
    expect(pillLabel(state({ status: 'downloading', version: '0.5.0', percent: 41.6 }))).toBe('Downloading 0.5.0 42%')
    expect(pillLabel(state({ status: 'ready', version: '0.5.0' }))).toBe('Restart to update')
    expect(pillLabel(state({ status: 'error', version: '0.5.0' }))).toBe('Update failed')
  })

  it('shows only for actionable states and respects Later', () => {
    expect(showUpdatePill(state({ status: 'idle' }))).toBe(false)
    expect(showUpdatePill(state({ status: 'checking' }))).toBe(false)
    expect(showUpdatePill(state({ status: 'available', version: '0.5.0' }))).toBe(true)
    expect(showUpdatePill(state({ status: 'available', version: '0.5.0', dismissed: true }))).toBe(false)
    expect(showUpdatePill(state({ status: 'ready', version: '0.5.0', dismissed: true }))).toBe(false)
    expect(showUpdatePill(state({ status: 'downloading', version: '0.5.0', dismissed: true }))).toBe(true)
    expect(showUpdatePill(state({ status: 'error' }))).toBe(true)
    expect(showUpdatePill(state({ status: 'available', mode: 'dev', version: '0.5.0' }))).toBe(false)
  })
})

describe('status line', () => {
  it('reports up to date with a relative time', () => {
    expect(updateStatusLine(state({ checkedAt: 0 }), 5 * 60_000)).toBe('Dawsha 0.4.0 · up to date · checked 5 minutes ago')
    expect(updateStatusLine(state({ checkedAt: null }), 0)).toBe('Dawsha 0.4.0 · not checked yet')
  })

  it('reports available, portable and development', () => {
    expect(updateStatusLine(state({ status: 'available', version: '0.5.0' }), 0)).toBe('Dawsha 0.4.0 · update available')
    expect(updateStatusLine(state({ mode: 'portable' }), 0)).toBe('Dawsha 0.4.0 · portable build: updates from GitHub')
    expect(updateStatusLine(state({ mode: 'dev' }), 0)).toContain('updates are off')
  })

  it('formats ages', () => {
    expect(formatAgo(0, 30_000)).toBe('just now')
    expect(formatAgo(0, 60_000)).toBe('1 minute ago')
    expect(formatAgo(0, 3 * 3_600_000)).toBe('3 hours ago')
    expect(formatAgo(0, 2 * 86_400_000)).toBe('2 days ago')
  })
})

describe('update settings', () => {
  it('defaults to automatic checks and no seen version', () => {
    expect(defaultSettings()).toMatchObject({ autoUpdateCheck: true, lastSeenVersion: null })
  })

  it('keeps a valid seen version and only an explicit false for automatic checks', () => {
    expect(migrateSettings({ lastSeenVersion: '0.3.0', autoUpdateCheck: false })).toMatchObject({ lastSeenVersion: '0.3.0', autoUpdateCheck: false })
    expect(migrateSettings({ lastSeenVersion: 'banana', autoUpdateCheck: 'no' })).toMatchObject({ lastSeenVersion: null, autoUpdateCheck: true })
  })
})
