import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../../src/main/settingsStore'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'
import { buildEnvelope, parseTransfer, planImport } from '../../src/shared/settingsTransfer'
import { sectionsMatching } from '../../src/shared/settingsSearch'

describe('limit line length setting', () => {
  it('defaults off and turns on only for true', () => {
    expect(defaultSettings().limitLineLength).toBe(false)
    expect(migrateSettings({}).limitLineLength).toBe(false)
    expect(migrateSettings({ limitLineLength: 'yes' }).limitLineLength).toBe(false)
    expect(migrateSettings({ limitLineLength: true }).limitLineLength).toBe(true)
  })

  it('resets the value 1.10.0 and 1.10.1 wrote on their own, once', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dawsha-measure-')), 'settings.json')
    writeFileSync(file, JSON.stringify({ limitLineLength: true, lastSeenVersion: '1.10.1' }))
    expect(new SettingsStore(file).load().settings.limitLineLength).toBe(false)
    writeFileSync(file, JSON.stringify({ limitLineLength: true, lastSeenVersion: '1.10.2' }))
    expect(new SettingsStore(file).load().settings.limitLineLength).toBe(true)
  })

  it('turns off the catch-up card 1.10.0 to 1.10.3 switched on by themselves, once', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dawsha-measure-')), 'settings.json')
    expect(defaultSettings().catchUp).toBe(false)
    writeFileSync(file, JSON.stringify({ catchUp: true, lastSeenVersion: '1.10.3' }))
    expect(new SettingsStore(file).load().settings.catchUp).toBe(false)
    writeFileSync(file, JSON.stringify({ catchUp: true, lastSeenVersion: '1.10.4' }))
    expect(new SettingsStore(file).load().settings.catchUp).toBe(true)
  })

  it('persists, transfers and is found by search', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dawsha-measure-')), 'settings.json')
    new SettingsStore(file).update({ limitLineLength: true })
    const loaded = new SettingsStore(file).load().settings
    expect(loaded.limitLineLength).toBe(true)
    const envelope = buildEnvelope(loaded, '1.10.0', new Date())
    const parsed = parseTransfer(JSON.stringify(envelope))
    if (!parsed.ok) throw new Error(parsed.error)
    const plan = planImport({ current: defaultSettings(), data: parsed.transfer.data, mode: 'merge', missingFolders: new Set(), newId: () => 'new', keepFullAccess: false })
    expect(plan.patch.limitLineLength).toBe(true)
    expect(plan.summary.preferences).toContain('Limit line length in full screen')
    const sections = [{ id: 'general', label: 'General', lede: '' }]
    expect(sectionsMatching(sections, 'line length')).toEqual(sections)
  })
})
