import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const SCREENS = 'test-results/screens'

test('Ctrl+/ and the palette open a searchable, read-only keyboard shortcuts sheet', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await page.locator('.term-host.active').click()

    await page.keyboard.press('Control+/')
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(sheet).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Search shortcuts' })).toBeFocused()
    await expect(sheet.locator('.shortcuts-group h3')).toHaveText(['Sessions', 'Panes', 'Terminal', 'Views', 'General'])
    await expect(sheet.getByRole('listitem').filter({ hasText: 'Open the command palette' }).locator('kbd')).toHaveText('Ctrl+K')
    await expect(sheet.getByRole('listitem').filter({ hasText: 'New session' }).first().locator('kbd')).toHaveText('Ctrl+N')
    await expect(sheet.getByRole('listitem').filter({ hasText: 'Keyboard shortcuts' }).locator('kbd')).toHaveText('Ctrl+/')
    // The nine Focus pane keys are one row, and the search box has the app's text box look.
    await expect(sheet.locator('.shortcuts-list li').filter({ hasText: /^Focus pane/ })).toHaveCount(1)
    await expect(sheet.locator('.shortcuts-list li').filter({ hasText: 'Focus pane 1–9' }).locator('kbd')).toHaveText('Ctrl+1…9')
    await expect(page.getByRole('searchbox', { name: 'Search shortcuts' })).toHaveClass(/text-input/)
    await page.screenshot({ path: join(SCREENS, 'shortcuts-sheet.png') })

    // Filtering as you type, by title, by keys and by group; nothing in it is editable beyond the search box.
    await page.keyboard.type('focus pane 3')
    await expect(sheet.locator('.shortcuts-list li')).toHaveText([/Focus pane 1–9/])
    await page.getByRole('searchbox', { name: 'Search shortcuts' }).fill('')
    await page.keyboard.type('timeline')
    await expect(sheet.locator('.shortcuts-list li')).toHaveCount(2)
    await expect(sheet.locator('.shortcuts-list li').filter({ hasText: 'Show session timeline' }).locator('kbd')).toHaveText('Ctrl+Shift+T')
    await page.getByRole('searchbox', { name: 'Search shortcuts' }).fill('ctrl+shift+alt')
    await expect(sheet.locator('.shortcuts-list li').first()).toContainText('Move the pane')
    await page.getByRole('searchbox', { name: 'Search shortcuts' }).fill('zzzz')
    await expect(sheet.locator('.shortcuts-empty')).toBeVisible()
    await expect(sheet.locator('input')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)

    await page.keyboard.press('Control+k')
    await page.locator('#palette-input').fill('keyboard shortcuts')
    await page.keyboard.press('Enter')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
