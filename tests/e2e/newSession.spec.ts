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

test('compact header keeps New session, zoom, Settings and Theme usable at 960px', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.setViewportSize({ width: 960, height: 600 })
    const newSession = page.getByRole('button', { name: 'New session, Ctrl+N' })
    await expect(newSession).toContainText('New session')
    for (const name of ['Decrease font size', 'Increase font size', 'Settings', 'Theme']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
    expect(await page.locator('.topbar').evaluate((bar) => bar.scrollWidth <= bar.clientWidth)).toBe(true)
    await page.getByRole('button', { name: 'Theme', exact: true }).click()
    await expect(page.locator('.theme-picker')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.locator('.settings-view')).toBeVisible()
    await newSession.click()
    await expect(page.locator('.quickpick')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})
