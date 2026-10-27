import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

test('run editor shortcuts save the command and close the panel without closing the source file', async () => {
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.projectFolder, 'example.txt'), 'Keep this source file open')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#files-button').click()
    await page.locator('.files-row[data-path="example.txt"]').click()
    await page.locator('#files-run-toggle').click()
    await expect(page.locator('#run-message')).toContainText('No run commands')
    await page.locator('#run-add').click()
    await page.getByLabel('Command name', { exact: true }).fill('Local task')
    await page.getByLabel('Command', { exact: true }).fill('node -e "console.log(1)"')
    await page.getByLabel('Working directory', { exact: true }).fill('.')
    await page.keyboard.press('Control+s')
    await expect(page.locator('.run-editor')).toBeHidden()
    await expect(page.locator('#run-command')).toContainText('Local task')
    await expect(page.locator('.files-tab')).toHaveCount(1)
    await page.locator('#run-output').focus()
    await page.keyboard.press('e')
    await expect(page.locator('#files-edit')).toHaveText('Edit')
    await page.keyboard.press('Control+w')
    await expect(page.locator('#files-run-panel')).toBeHidden()
    await expect(page.locator('.files-tab')).toHaveCount(1)
  } finally {
    await closeApp(app)
  }
})
