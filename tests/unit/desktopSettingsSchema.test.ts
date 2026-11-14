import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../../src/main/settingsStore'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'
import { buildTransferData } from '../../src/shared/settingsTransfer'

describe('desktop and warning settings', () => {
  it('preserves old close behavior and enables warnings for existing users', () => {
    expect(defaultSettings().desktop).toEqual({ closeBehavior: 'quit', startHidden: false })
    expect(migrateSettings({}).desktop).toEqual({ closeBehavior: 'quit', startHidden: false })
    expect(migrateSettings({}).warnUsageLimits).toBe(true)
    expect(migrateSettings({ warnUsageLimits: false }).warnUsageLimits).toBe(false)
  })

  it('writes tray, hidden-start, one-time notice and threshold dedupe immediately to disk', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dawsha-desktop-')), 'settings.json')
    new SettingsStore(file).update({ desktop: { closeBehavior: 'tray', startHidden: true }, trayNoticeShown: true, warnedUsageWindows: { 'claude:five_hour': { resetsAt: 123456789, threshold: 95 } } })
    expect(new SettingsStore(file).load().settings).toMatchObject({ desktop: { closeBehavior: 'tray', startHidden: true }, trayNoticeShown: true, warnedUsageWindows: { 'claude:five_hour': { resetsAt: 123456789, threshold: 95 } } })
  })

  it('never exports local startup choices, notice history or warning dedupe', () => {
    const data = buildTransferData({ ...defaultSettings(), desktop: { closeBehavior: 'tray', startHidden: true }, trayNoticeShown: true, warnUsageLimits: false })
    expect(data).not.toHaveProperty('desktop')
    expect(data).not.toHaveProperty('trayNoticeShown')
    expect(data).not.toHaveProperty('warnedUsageWindows')
    expect(data.warnUsageLimits).toBe(false)
  })
})
