import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

test('the tour card buttons take mouse clicks: Next moves on, Back returns, Skip tour closes it', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#more-button').click()
    await page.getByRole('menuitem', { name: 'Take the tour' }).click()

    const card = page.locator('.tour-card')
    await expect(card).toBeVisible()
    const firstTitle = await card.locator('h2').textContent()

    await card.getByRole('button', { name: 'Next' }).click()
    await expect(card.locator('h2')).not.toHaveText(firstTitle ?? '')

    await card.getByRole('button', { name: 'Back' }).click()
    await expect(card.locator('h2')).toHaveText(firstTitle ?? '')

    await card.getByRole('button', { name: 'Skip tour' }).click()
    await expect(card).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
