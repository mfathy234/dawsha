import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp } from '../e2e/helpers'
import { askPermission, launchDemo } from './v17Demo'

const OUT = resolve(__dirname, '../../test-results/redesign-v180')

test('captures the redesigned shell and grid in dark and light themes', async () => {
  mkdirSync(OUT, { recursive: true })
  for (const [theme, name] of [['grid-dark', 'dark'], ['dawsha-daylight', 'light']] as const) {
    const { app, page } = await launchDemo({ theme: { id: theme } })
    try {
      await expect(page.locator('html')).toHaveAttribute('data-kind', name)
      await page.locator('.pane-title', { hasText: 'Add dark mode toggle' }).click()
      await askPermission(page, 1)
      await expect(page.locator('.pane.needs-you .pane-permission')).toBeVisible()
      await page.screenshot({ path: resolve(OUT, `grid-${name}.png`) })
      await page.screenshot({ path: resolve(OUT, `topbar-${name}.png`) })

      await page.locator('#settings-button').click()
      await expect(page.locator('.settings-view')).toBeVisible()
      await page.screenshot({ path: resolve(OUT, `settings-${name}.png`) })
      await page.locator('#settings-tab-appearance').click()
      await page.screenshot({ path: resolve(OUT, `settings-appearance-${name}.png`) })

      await page.locator('#files-button').click()
      await expect(page.locator('#files-view')).toBeVisible()
      await page.locator('#files-mode-review').click()
      await page.screenshot({ path: resolve(OUT, `files-review-${name}.png`) })
      await page.locator('#search-button').click()
      await expect(page.locator('.palette')).toBeVisible()
      await page.screenshot({ path: resolve(OUT, `palette-${name}.png`) })
      await page.keyboard.press('Escape')

      await page.locator('#search-button').click()
      await page.locator('#palette-input').fill('Keyboard shortcuts')
      await page.keyboard.press('Enter')
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
      await page.screenshot({ path: resolve(OUT, `dialog-${name}.png`) })
      await page.keyboard.press('Escape')

      await page.locator('#settings-button').click()
      await page.locator('#settings-tab-about').click()
      await page.locator('#whats-new').click()
      await expect(page.getByRole('dialog', { name: /What's new in Dawsha/ })).toBeVisible()
      await page.screenshot({ path: resolve(OUT, `whats-new-${name}.png`) })
    } finally {
      await closeApp(app)
    }
  }
})
