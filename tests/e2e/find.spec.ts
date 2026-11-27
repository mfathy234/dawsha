import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, launchApp } from './helpers'

const SCREENS = 'test-results/screens'

test('Ctrl+Shift+F finds text in the terminal, steps through matches and closes with Esc', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const host = page.locator('.term-host.active')
    const id = (await host.getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
    const text = '\x1b[2J\x1b[H\r\nBuild failed: Needle missing\r\nretrying\r\nneedle found in cache\r\nNEEDLE again\r\n'
    await feedTerminal(page, id, text)
    await expect.poll(() => bufferText(page, id)).toContain('NEEDLE again')

    await host.click()
    await page.keyboard.press('Control+Shift+F')
    const bar = page.getByRole('search')
    const input = bar.getByLabel('Find in terminal')
    await expect(input).toBeFocused()
    // ConPTY can repaint over the fed text after the first read, so feed it again until the search sees all three.
    await expect(async () => {
      await feedTerminal(page, id, text)
      await input.fill('')
      await input.fill('needle')
      await expect(bar.locator('.term-find-count')).toHaveText(/of 3$/, { timeout: 2000 })
    }).toPass({ timeout: 20_000 })
    const first = await bar.locator('.term-find-count').textContent()
    await input.press('Enter')
    await expect(bar.locator('.term-find-count')).not.toHaveText(first!)
    await page.screenshot({ path: join(SCREENS, '60-find-in-terminal.png') })

    await bar.getByRole('button', { name: 'Match case' }).click()
    await expect(bar.getByRole('button', { name: 'Match case' })).toHaveAttribute('aria-pressed', 'true')
    await expect(bar.locator('.term-find-count')).toHaveText('1 of 1')

    await input.fill('zzz-not-here')
    await expect(bar.locator('.term-find-count')).toHaveText('No results')

    await input.press('Escape')
    await expect(bar).toBeHidden()
    await expect(page.locator('.term-host.active .xterm-helper-textarea')).toBeFocused()

    await page.keyboard.press('Control+k')
    await page.keyboard.type('find in the terminal')
    await page.getByRole('option', { name: /^Find in the terminal/ }).click()
    await expect(bar).toBeVisible()
    await expect(input).toBeFocused()
    await input.press('Escape')

    await host.click()
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    await page.keyboard.press('Control+Shift+F')
    await expect(input).toBeFocused()
    await input.press('Escape')
    await expect(bar).toBeHidden()
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
  } finally {
    await closeApp(app)
  }
})
