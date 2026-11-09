import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

test('Search all sessions opens from the command palette and closes with Escape', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const input = page.getByPlaceholder('Type a command, a session or a project')
    await expect(input).toBeVisible()
    await input.fill('Search all sessions')
    await page.locator('.palette-row[data-command="view.sessionSearch"]').click()
    const dialog = page.getByRole('dialog', { name: 'Search all sessions' })
    await expect(dialog).toBeVisible()
    await expect(page.locator('#global-search-input')).toBeFocused()
    await expect(dialog).toContainText('Type to search')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  } finally {
    await closeApp(app)
  }
})
