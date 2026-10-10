import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

test('top bar shows the brand and the split New session button picks the agent', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(page).toHaveTitle('Dawsha')
    await expect(page.locator('.app-title')).toHaveText('Dawsha')
    await expect(page.locator('.app-logo svg')).toBeVisible()

    const chevron = page.getByRole('button', { name: 'Choose agent', exact: true })
    await expect(chevron).toHaveAttribute('aria-haspopup', 'menu')
    await expect(chevron).toHaveAttribute('aria-expanded', 'false')
    await chevron.click()
    await expect(chevron).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menuitem')).toHaveText(['Claude session', 'Codex session', 'Gemini session', 'Resume a session…Ctrl+Shift+R', 'Ask two agents…Ctrl+Shift+A'])
    await expect(page.getByRole('menuitem', { name: /Claude session/ })).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: /Codex session/ })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(chevron).toHaveAttribute('aria-expanded', 'false')

    await chevron.click()
    await page.getByRole('menuitem', { name: /Gemini session/ }).click()
    await expect(page.locator('.quickpick')).toBeVisible()
    await expect(page.locator('.quickpick .option').first()).toContainText('Gemini')
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['gemini'])

    await page.getByRole('button', { name: 'New session, Ctrl+N' }).click()
    await expect(page.locator('.quickpick .option').first()).toContainText('Claude')
  } finally {
    await closeApp(app)
  }
})
