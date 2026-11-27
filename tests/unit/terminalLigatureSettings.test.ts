import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../../src/main/settingsStore'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'
import { buildEnvelope, parseTransfer, planImport } from '../../src/shared/settingsTransfer'
import { sectionsMatching } from '../../src/shared/settingsSearch'

describe('terminal font ligature settings', () => {
  it('defaults off and enables only for true', () => {
    expect(defaultSettings().fontLigatures).toBe(false)
    expect(migrateSettings({}).fontLigatures).toBe(false)
    expect(migrateSettings({ fontLigatures: 'yes' }).fontLigatures).toBe(false)
    expect(migrateSettings({ fontLigatures: true }).fontLigatures).toBe(true)
  })

  it('persists and transfers the preference with a readable preview', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dawsha-ligatures-')), 'settings.json')
    new SettingsStore(file).update({ fontLigatures: true })
    const loaded = new SettingsStore(file).load().settings
    expect(loaded.fontLigatures).toBe(true)
    const envelope = buildEnvelope(loaded, '1.10.0', new Date())
    expect(envelope.data.fontLigatures).toBe(true)
    const parsed = parseTransfer(JSON.stringify(envelope))
    if (!parsed.ok) throw new Error(parsed.error)
    for (const mode of ['merge', 'replace'] as const) {
      const plan = planImport({ current: defaultSettings(), data: parsed.transfer.data, mode, missingFolders: new Set(), newId: () => 'new', keepFullAccess: false })
      expect(plan.patch.fontLigatures).toBe(true)
      expect(plan.summary.preferences).toContain('Font ligatures')
    }
    expect(parseTransfer(JSON.stringify({ ...envelope, data: { fontLigatures: 'yes' } })).ok).toBe(false)
  })

  it('finds the font ligature setting in General', () => {
    const sections = [{ id: 'general', label: 'General', lede: '' }]
    expect(sectionsMatching(sections, 'font ligatures')).toEqual(sections)
  })
})
