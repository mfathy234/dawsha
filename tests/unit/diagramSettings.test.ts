import { describe, expect, it } from 'vitest'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'
import { buildTransferData, EXCLUDED_KEYS } from '../../src/shared/settingsTransfer'

describe('local diagram settings', () => {
  it('starts without a jar override and retains an existing jar path', () => {
    expect(defaultSettings().plantumlJarPath).toBe('')
    expect(migrateSettings({ plantumlJarPath: ' C:\\tools\\plantuml.jar ' }).plantumlJarPath).toBe('C:\\tools\\plantuml.jar')
  })

  it('discards invalid path settings', () => {
    for (const value of [42, null, {}, 'bad\u0000.jar', 'x'.repeat(5000)]) {
      expect(migrateSettings({ plantumlJarPath: value }).plantumlJarPath).toBe('')
    }
  })

  it('keeps this computer jar path out of portable settings', () => {
    expect(EXCLUDED_KEYS).toContain('plantumlJarPath')
    expect(buildTransferData(migrateSettings({ plantumlJarPath: 'C:\\tools\\plantuml.jar' }))).not.toHaveProperty('plantumlJarPath')
  })
})
