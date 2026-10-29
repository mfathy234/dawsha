import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp } from '../e2e/helpers'
import { askPermission, launchDemo } from './v17Demo'

const OUT = resolve(__dirname, '../../test-results/redesign-v180')

test('captures the redesigned grid in dark and light themes', async () => {
  mkdirSync(OUT, { recursive: true })
  for (const [theme, name] of [['grid-dark', 'dark'], ['dawsha-daylight', 'light']] as const) {
    const { app, page } = await launchDemo({ theme: { id: theme } })
    try {
      await expect(page.locator('html')).toHaveAttribute('data-kind', name)
      await page.locator('.pane-title', { hasText: 'Add dark mode toggle' }).click()
      await askPermission(page, 1)
      await expect(page.locator('.pane.needs-you .pane-permission')).toBeVisible()
      await page.screenshot({ path: resolve(OUT, `grid-${name}.png`) })
    } finally {
      await closeApp(app)
    }
  }
})
