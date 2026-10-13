import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { bufferText, closeApp, createSandbox, lastInput, launchApp } from './helpers'

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test('Ctrl+V with a screenshot on the clipboard saves it and pastes its path', async () => {
  const pasteDir = mkdtempSync(join(tmpdir(), 'dawsha-paste-'))
  const { app, page } = await launchApp(createSandbox(), { DAWSHA_PASTE_DIR: pasteDir })
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await page.getByRole('button', { name: 'New terminal in SMOKE' }).click()
    await page.getByRole('menuitem', { name: 'Shell' }).click()
    const host = page.locator('.term-host.active')
    const id = (await host.getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)

    await app.evaluate(async ({ clipboard, ClipboardItem }, base64) => {
      const blob = new Blob([Buffer.from(base64, 'base64')], { type: 'image/png' })
      await clipboard.write([new ClipboardItem({ 'image/png': blob })])
    }, PNG_1PX)
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.show()
      window.focus()
      window.webContents.focus()
    })
    await page.bringToFront()
    await page.locator(`.term-host[data-term-id="${id}"] .xterm-helper-textarea`).focus()
    // Check the page's active element: on hosted Windows runners the OS window can lose
    // focus between steps, but Playwright delivers keys to the page either way.
    await expect
      .poll(() => page.evaluate(() => (document.activeElement?.closest('.term-host') as HTMLElement | null)?.dataset.termId ?? null))
      .toBe(id)
    await page.keyboard.press('Control+v')

    await expect.poll(() => readdirSync(pasteDir).filter((name) => name.endsWith('.png')).length, { timeout: 15_000 }).toBe(1)
    const saved = readdirSync(pasteDir)[0]
    await expect.poll(() => lastInput(page, id), { timeout: 15_000 }).toBe(`${join(pasteDir, saved)} `)
  } finally {
    await app.evaluate(async ({ clipboard }) => clipboard.writeText(''))
    await closeApp(app)
  }
})
