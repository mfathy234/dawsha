import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../../src/main/settingsStore'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'
import { buildEnvelope, parseTransfer, planImport } from '../../src/shared/settingsTransfer'
import { sectionsMatching } from '../../src/shared/settingsSearch'

describe('reading view setting', () => {
  it('defaults off and enables only for true', () => {
    expect(defaultSettings().readingOnScroll).toBe(false)
    expect(migrateSettings({}).readingOnScroll).toBe(false)
    expect(migrateSettings({ readingOnScroll: 'yes' }).readingOnScroll).toBe(false)
    expect(migrateSettings({ readingOnScroll: true }).readingOnScroll).toBe(true)
  })

  it('persists and transfers the preference', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dawsha-reading-')), 'settings.json')
    new SettingsStore(file).update({ readingOnScroll: true })
    const loaded = new SettingsStore(file).load().settings
    expect(loaded.readingOnScroll).toBe(true)
    const envelope = buildEnvelope(loaded, '1.10.0', new Date())
    const parsed = parseTransfer(JSON.stringify(envelope))
    if (!parsed.ok) throw new Error(parsed.error)
    const plan = planImport({ current: defaultSettings(), data: parsed.transfer.data, mode: 'merge', missingFolders: new Set(), newId: () => 'new', keepFullAccess: false })
    expect(plan.patch.readingOnScroll).toBe(true)
    expect(plan.summary.preferences).toContain('Reading view on scroll')
  })

  it('can be found in Settings', () => {
    const sections = [{ id: 'general', label: 'General', lede: '' }]
    expect(sectionsMatching(sections, 'reading view')).toEqual(sections)
  })
})
