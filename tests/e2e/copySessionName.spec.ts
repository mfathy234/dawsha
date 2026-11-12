import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const NEW_IN_SMOKE = /^New (Claude|Codex|Gemini) session in Smoke$/

test('Copy session name is in the pane menu and the sidebar session menu', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    const name = (await page.locator('.kept-session-row:not(.closed) .sess-row .sess-name').first().textContent())!.trim()
    const toasts = page.locator('.toasts')

    await page.locator('.pane').first().getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menu', { name: 'Pane actions' }).getByRole('menuitem', { name: 'Copy session name' }).click()
    await expect(toasts).toContainText(`Copied “${name}”`)
    // The system clipboard round-trips on CI; a local desktop session may block it.
    if (process.env.CI) await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(name)

    const row = page.locator('.kept-session-row:not(.closed)').first()
    await row.hover()
    await row.getByRole('button', { name: new RegExp(`^Actions for .* in Smoke$`) }).click()
    await page.getByRole('menuitem', { name: 'Copy session name' }).click()
    await expect(toasts).toContainText(`Copied “${name}”`)
  } finally {
    await closeApp(app)
  }
})
