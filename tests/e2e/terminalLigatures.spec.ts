import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bufferText, closeApp, closeSettings, createSandbox, feedTerminal, launchApp, openSettings, openTerminalPicker } from './helpers'

test('font ligatures toggle open and future terminals in the isolated renderer', async () => {
  const { app, page } = await launchApp(createSandbox())
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const window = await app.browserWindow(page)
    await window.evaluate((browserWindow) => browserWindow.setSize(1024, 768))
    expect(await page.evaluate(() => typeof (globalThis as Record<string, unknown>).require)).toBe('undefined')
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const id = (await page.locator('.term-host.active').getAttribute('data-term-id'))!
    const terminal = page.locator(`.term-host[data-term-id="${id}"] .xterm`)
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
    await feedTerminal(page, id, '\x1b[2J\x1b[H=== != => -> <=\r\n')
    await openSettings(page)
    const toggle = page.getByRole('switch', { name: 'Font ligatures', exact: true })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(terminal).toHaveCSS('font-feature-settings', '"calt", "liga"')
    const label = page.locator('.set-name', { hasText: /^Font ligatures$/ })
    expect(await label.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return range.getClientRects().length
    })).toBe(1)
    await closeSettings(page)
    await openTerminalPicker(page.locator('.pane').first())
    await page.getByRole('menuitem', { name: 'Shell', exact: true }).click()
    await expect(page.locator('.term-host.active .xterm')).toHaveCSS('font-feature-settings', '"calt", "liga"')
    await openSettings(page)
    await toggle.click()
    await expect(terminal).toHaveCSS('font-feature-settings', 'normal')
    await closeSettings(page)
    await expect(page.locator('.term-host.active .xterm')).toHaveCSS('font-feature-settings', 'normal')
    expect(await bufferText(page, id)).toContain('=== != => -> <=')
    expect(errors).toEqual([])
  } finally {
    await closeApp(app)
  }
})

test('font ligatures join and unjoin existing text in the light-theme DOM renderer', async () => {
  const sandbox = createSandbox()
  const settingsFile = join(sandbox.userData, 'settings.json')
  const settings = JSON.parse(readFileSync(settingsFile, 'utf8'))
  writeFileSync(settingsFile, JSON.stringify({ ...settings, theme: { id: 'github-light' } }))
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const id = (await page.locator('.term-host.active').getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
    await feedTerminal(page, id, '\x1b[2J\x1b[H=== != => -> <=\r\n')
    const joined = page.locator('.term-host .xterm-rows span').filter({ hasText: /^===$/ })
    await expect(joined).toHaveCount(0)
    await openSettings(page)
    const toggle = page.getByRole('switch', { name: 'Font ligatures', exact: true })
    await toggle.click()
    await closeSettings(page)
    await expect(joined).toHaveCount(1)
    await openSettings(page)
    await toggle.click()
    await closeSettings(page)
    await expect(joined).toHaveCount(0)
    expect(await bufferText(page, id)).toContain('=== != => -> <=')
  } finally {
    await closeApp(app)
  }
})
