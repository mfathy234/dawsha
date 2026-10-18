import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

test('imports Paneon settings on the next launch after backing up Dawsha settings', async () => {
  const sandbox = createSandbox()
  const paneonDir = join(sandbox.root, 'Paneon')
  mkdirSync(paneonDir)
  const dawshaPath = join(sandbox.userData, 'settings.json')
  const original = readFileSync(dawshaPath, 'utf8')
  const paneon = {
    ...JSON.parse(original),
    projects: [{ id: 'paneon-project', name: 'From Paneon', folder: sandbox.projectFolder, defaultAgent: 'codex' }],
    sidebarCollapsed: true
  }
  const paneonText = JSON.stringify(paneon)
  writeFileSync(join(paneonDir, 'settings.json'), paneonText)
  const env = { DAWSHA_PANEON_USER_DATA: paneonDir }

  const first = await launchApp(sandbox, env)
  try {
    await first.page.locator('#settings-button').click()
    await expect(first.page.locator('#import-paneon-settings')).toBeVisible()
    await expect(first.page.locator('#paneon-import-summary')).toContainText('1 project')
    await first.page.locator('#import-paneon-settings').click()
    await expect(first.page.getByRole('alertdialog')).toContainText('backup')
    await first.page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
    expect(existsSync(join(sandbox.userData, 'paneon-import.pending.json'))).toBe(false)
    await first.page.locator('#import-paneon-settings').click()
    await first.page.getByRole('alertdialog').getByRole('button', { name: 'Import Paneon settings' }).click()
    await expect(first.page.locator('#paneon-import-summary')).toContainText('reopen Dawsha')
    expect(existsSync(join(sandbox.userData, 'paneon-import.pending.json'))).toBe(true)
    expect(readFileSync(dawshaPath, 'utf8')).toBe(original)
  } finally {
    await closeApp(first.app)
  }

  const second = await launchApp(sandbox, env)
  try {
    await expect(second.page.getByRole('button', { name: 'From Paneon' })).toBeVisible()
    const imported = JSON.parse(readFileSync(dawshaPath, 'utf8'))
    expect(imported.projects[0].name).toBe('From Paneon')
    expect(imported.sidebarCollapsed).toBe(true)
    expect(readFileSync(join(paneonDir, 'settings.json'), 'utf8')).toBe(paneonText)
    expect(readdirSync(sandbox.userData).some((name) => name.startsWith('settings.json.pre-paneon-') && name.endsWith('.bak'))).toBe(true)
    expect(existsSync(join(sandbox.userData, 'paneon-import.pending.json'))).toBe(false)
  } finally {
    await closeApp(second.app)
  }
})

test('quarantines a damaged pending import and allows a fresh import', async () => {
  const sandbox = createSandbox()
  const paneonDir = join(sandbox.root, 'Paneon')
  mkdirSync(paneonDir)
  const dawshaPath = join(sandbox.userData, 'settings.json')
  const original = readFileSync(dawshaPath, 'utf8')
  writeFileSync(join(paneonDir, 'settings.json'), original)
  writeFileSync(join(sandbox.userData, 'paneon-import.pending.json'), '{broken')

  const launched = await launchApp(sandbox, { DAWSHA_PANEON_USER_DATA: paneonDir })
  try {
    expect(readFileSync(dawshaPath, 'utf8')).toBe(original)
    expect(existsSync(join(sandbox.userData, 'paneon-import.pending.json'))).toBe(false)
    expect(readdirSync(sandbox.userData).some((name) => name.startsWith('paneon-import.invalid-') && name.endsWith('.json'))).toBe(true)
    await launched.page.locator('#settings-button').click()
    await expect(launched.page.locator('#import-paneon-settings')).toBeEnabled()
    await launched.page.locator('#import-paneon-settings').click()
    await launched.page.getByRole('alertdialog').getByRole('button', { name: 'Import Paneon settings' }).click()
    expect(existsSync(join(sandbox.userData, 'paneon-import.pending.json'))).toBe(true)
  } finally {
    await closeApp(launched.app)
  }
})
