import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openSettings } from './helpers'

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

async function savePreset(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.locator('#new-session').click()
  await expect(page.locator('.quickpick')).toBeVisible()
  await page.getByRole('button', { name: 'Save as preset…' }).click()
  await expect(page.locator('.quickpick')).toHaveCount(0)
  const dialog = page.getByRole('dialog', { name: 'Save as preset' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Agent').selectOption('shell')
  await dialog.getByRole('button', { name: 'Save preset' }).click()
  await expect(dialog).toHaveCount(0)
}

test('a saved shell preset starts from the palette and from the New session menu', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await savePreset(page, 'Shell scratch')
    await expect.poll(() => readSettings(sandbox.userData).presets?.map((p: any) => [p.name, p.agent, p.worktree])).toEqual([['Shell scratch', 'shell', false]])

    await page.locator('#search-button').click()
    await expect(page.locator('#palette-input')).toBeFocused()
    await page.keyboard.type('Start preset')
    await expect(page.locator('.palette-row')).toHaveText([/Start preset: Shell scratch/])
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['shell'])

    await page.locator('#new-session-agent').click()
    await page.getByRole('menuitem', { name: 'Start preset: Shell scratch' }).click()
    await expect(page.locator('.pane')).toHaveCount(2)
  } finally {
    await closeApp(app)
  }
})

test('presets are managed in Settings and deleting asks first, naming the preset', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await savePreset(page, 'Shell scratch')
    await openSettings(page, 'agents')
    await expect(page.locator('[data-preset]')).toContainText('Shell scratch')

    await page.getByRole('button', { name: 'Delete Shell scratch' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('Shell scratch')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('[data-preset]')).toHaveCount(1)

    await page.getByRole('button', { name: 'Delete Shell scratch' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete Shell scratch' }).click()
    await expect(page.locator('[data-preset]')).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox.userData).presets).toEqual([])
  } finally {
    await closeApp(app)
  }
})
