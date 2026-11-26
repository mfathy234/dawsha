import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../../src/main/settingsStore'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'
import { buildEnvelope, parseTransfer, planImport } from '../../src/shared/settingsTransfer'
import { sectionsMatching } from '../../src/shared/settingsSearch'

describe('limit line length setting', () => {
  it('defaults on and turns off only for false', () => {
    expect(defaultSettings().limitLineLength).toBe(true)
    expect(migrateSettings({}).limitLineLength).toBe(true)
    expect(migrateSettings({ limitLineLength: 'no' }).limitLineLength).toBe(true)
    expect(migrateSettings({ limitLineLength: false }).limitLineLength).toBe(false)
  })

  it('persists, transfers and is found by search', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dawsha-measure-')), 'settings.json')
    new SettingsStore(file).update({ limitLineLength: false })
    const loaded = new SettingsStore(file).load().settings
    expect(loaded.limitLineLength).toBe(false)
    const envelope = buildEnvelope(loaded, '1.10.0', new Date())
    const parsed = parseTransfer(JSON.stringify(envelope))
    if (!parsed.ok) throw new Error(parsed.error)
    const plan = planImport({ current: defaultSettings(), data: parsed.transfer.data, mode: 'merge', missingFolders: new Set(), newId: () => 'new', keepFullAccess: false })
    expect(plan.patch.limitLineLength).toBe(false)
    expect(plan.summary.preferences).toContain('Limit line length in full screen')
    const sections = [{ id: 'general', label: 'General', lede: '' }]
    expect(sectionsMatching(sections, 'line length')).toEqual(sections)
  })
})
