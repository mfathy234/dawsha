import { expect, it } from 'vitest'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'

it('defaults shell notifications on and clamps the remembered drawer height', () => {
  expect(defaultSettings().notifyLongCommands).toBe(true)
  expect(defaultSettings().shellDrawerHeight).toBe(240)
  expect(migrateSettings({ shellDrawerHeight: 900, notifyLongCommands: false }).shellDrawerHeight).toBe(600)
  expect(migrateSettings({ shellDrawerHeight: 'bad' }).shellDrawerHeight).toBe(240)
})
