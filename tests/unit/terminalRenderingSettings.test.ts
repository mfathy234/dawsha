import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../../src/main/settingsStore'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'
import { buildEnvelope, parseTransfer, planImport } from '../../src/shared/settingsTransfer'
import { sectionsMatching } from '../../src/shared/settingsSearch'

describe('terminal image settings', () => {
  it('defaults on and accepts only an explicit false to disable images', () => {
    expect(defaultSettings().showTerminalImages).toBe(true)
    expect(migrateSettings({}).showTerminalImages).toBe(true)
    expect(migrateSettings({ showTerminalImages: 'no' }).showTerminalImages).toBe(true)
    expect(migrateSettings({ showTerminalImages: false }).showTerminalImages).toBe(false)
  })

  it('persists the preference across a settings reload', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dawsha-rendering-')), 'settings.json')
    new SettingsStore(file).update({ showTerminalImages: false })
    expect(new SettingsStore(file).load().settings.showTerminalImages).toBe(false)
  })

  it('exports and imports the preference with a readable preview and rejects non-booleans', () => {
    const current = defaultSettings()
    const envelope = buildEnvelope({ ...current, showTerminalImages: false }, '1.10.0', new Date())
    expect(envelope.data.showTerminalImages).toBe(false)
    const parsed = parseTransfer(JSON.stringify(envelope))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.error)
    for (const mode of ['merge', 'replace'] as const) {
      const plan = planImport({ current, data: parsed.transfer.data, mode, missingFolders: new Set(), newId: () => 'new', keepFullAccess: false })
      expect(plan.patch.showTerminalImages).toBe(false)
      expect(plan.summary.preferences).toContain('Show images in the terminal')
    }
    expect(parseTransfer(JSON.stringify({ ...envelope, data: { showTerminalImages: 'yes' } })).ok).toBe(false)
  })

  it('finds inline image protocols in the existing General section', () => {
    const sections = [{ id: 'general', label: 'General', lede: '' }]
    for (const query of ['terminal images', 'sixel', 'IIP']) expect(sectionsMatching(sections, query)).toEqual(sections)
  })
})
