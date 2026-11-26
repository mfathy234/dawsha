import { expect, test } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, launchApp } from './helpers'

test('permission cards float without resizing the terminal', async () => {
  const { app, page } = await launchApp(createSandbox())
  const resizes: string[] = []
  page.on('console', (message) => { if (message.text().startsWith('[term] resize')) resizes.push(message.text()) })
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const pane = page.locator('.pane').first()
    const host = pane.locator('.term-host.active')
    const id = (await host.getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
    await page.waitForTimeout(500)
    const before = await host.boundingBox()
    const count = resizes.length
    await expect(async () => {
      await feedTerminal(page, id, '\r\n  Bash command\r\n\r\n    npm test\r\n\r\n Do you want to proceed?\r\n ❯ 1. Yes\r\n   2. No, and tell Claude what to do differently (esc)\r\n')
      await expect(pane.locator('.pane-permission')).toBeVisible({ timeout: 1500 })
    }).toPass({ timeout: 30_000 })
    await page.waitForTimeout(300)
    expect((await host.boundingBox())!.height).toBe(before!.height)
    expect(resizes.length).toBe(count)
    await expect(pane.getByRole('button', { name: 'Allow Claude to continue', exact: true })).toBeEnabled()
  } finally { await closeApp(app) }
})
