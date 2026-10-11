import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, launchApp } from './helpers'

const SLOW = 30_000

const viewportY = (page: Page, id: string): Promise<number> =>
  page.evaluate((termId) => (window as unknown as { __grid: { viewportY(id: string): number } }).__grid.viewportY(termId), id)

const promptMarkers = (page: Page, id: string): Promise<number> =>
  page.evaluate((termId) => (window as unknown as { __grid: { promptMarkers(id: string): number } }).__grid.promptMarkers(termId), id)

const selectLine = (page: Page, id: string, text: string): Promise<boolean> =>
  page.evaluate(
    ([termId, needle]) => (window as unknown as { __grid: { selectLine(id: string, t: string): boolean } }).__grid.selectLine(termId, needle),
    [id, text]
  )

const clipboardText = (app: ElectronApplication): Promise<string> =>
  app.evaluate(async ({ clipboard }) => await clipboard.readText())

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

async function runCommand(page: Page, id: string, command: string, expected: RegExp): Promise<void> {
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
  await expect.poll(() => bufferText(page, id), { timeout: SLOW }).toMatch(expected)
}

test('prompt markers, copy last reply, copy prompt, save selection and clear scrollback', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const host = page.locator('.term-host.active')
    const id = (await host.getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: SLOW }).toMatch(/>\s*$/m)
    await host.click()

    await runCommand(page, id, 'echo alpha-out', /^alpha-out$/m)
    await expect.poll(() => bufferText(page, id)).toMatch(/>\s*$/)
    await runCommand(page, id, 'for /L %i in (1,1,70) do @echo pad-%i', /^pad-70$/m)
    await expect.poll(() => bufferText(page, id)).toMatch(/>\s*$/)
    await runCommand(page, id, 'echo omega-out', /^omega-out$/m)
    await expect.poll(() => promptMarkers(page, id)).toBe(3)

    const bottom = await viewportY(page, id)
    await page.keyboard.press('Control+ArrowUp')
    await expect.poll(() => viewportY(page, id)).toBeLessThan(bottom)
    const afterFirst = await viewportY(page, id)
    await page.keyboard.press('Control+ArrowUp')
    await expect.poll(() => viewportY(page, id)).toBeLessThan(afterFirst)
    const earliest = await viewportY(page, id)
    await page.keyboard.press('Control+ArrowUp')
    await page.keyboard.press('Control+ArrowDown')
    await expect.poll(() => viewportY(page, id)).toBeGreaterThan(earliest)

    await page.keyboard.press('Control+Alt+c')
    await expect.poll(() => clipboardText(app), { timeout: SLOW }).toBe('omega-out')
    await expect(page.locator('.toast', { hasText: 'Copied 1 line' })).toBeVisible()

    await feedTerminal(page, id, '\r\nSNIP-TEXT build the billing-api now\r\n')
    await expect.poll(() => bufferText(page, id)).toContain('SNIP-TEXT build the billing-api now')
    expect(await selectLine(page, id, 'SNIP-TEXT')).toBe(true)
    await page.keyboard.press('Control+k')
    await page.getByPlaceholder('Type a command, a session or a project').fill('save selection')
    await page.getByRole('option', { name: /^Save selection as a snippet/ }).click()
    const dialog = page.getByRole('dialog', { name: 'New snippet' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Name')).toHaveValue('SNIP-TEXT build the billing-api now')
    await expect(dialog.getByLabel('Text')).toHaveValue('SNIP-TEXT build the billing-api now')
    await expect(dialog.getByLabel('Scope')).toHaveValue('smoke')
    await dialog.getByRole('button', { name: 'Save snippet' }).click()
    await expect(dialog).toBeHidden()
    await expect
      .poll(() => readSettings(sandbox.userData).snippets?.some((s: { text: string }) => s.text === 'SNIP-TEXT build the billing-api now'), {
        timeout: SLOW
      })
      .toBe(true)

    await host.click()
    const box = [
      '\x1b[2J\x1b[H',
      '╭' + '─'.repeat(42) + '╮\r\n',
      `│ > ${'Add dark mode toggle'.padEnd(38)} │\r\n`,
      `│   ${'and cover it with a test'.padEnd(38)} │\r\n`,
      '╰' + '─'.repeat(42) + '╯\r\n'
    ].join('')
    await feedTerminal(page, id, box)
    await expect.poll(() => bufferText(page, id)).toContain('Add dark mode toggle')
    await page.keyboard.press('Control+Alt+p')
    await expect.poll(() => clipboardText(app), { timeout: SLOW }).toBe('Add dark mode toggle\nand cover it with a test')
    await expect(page.locator('.toast', { hasText: 'Copied the prompt (45 characters)' })).toBeVisible()

    await feedTerminal(page, id, '\x1b[2J\x1b[H')
    await page.keyboard.type('zzz')
    await expect.poll(() => bufferText(page, id), { timeout: SLOW }).toContain('zzz')
    await page.keyboard.press('Control+Alt+p')
    await expect.poll(() => clipboardText(app), { timeout: SLOW }).toBe('zzz')
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Backspace')

    await page.getByRole('button', { name: 'Pane actions' }).first().click()
    await page.getByRole('menuitem', { name: 'Clear scrollback' }).click()
    await expect(page.locator('.toast', { hasText: 'Scrollback cleared' })).toBeVisible()
    await expect.poll(() => promptMarkers(page, id)).toBe(0)
    await expect.poll(() => bufferText(page, id)).not.toContain('pad-30')
    await host.click()
    await runCommand(page, id, 'echo still-alive', /^still-alive$/m)
    await expect.poll(() => promptMarkers(page, id)).toBe(1)
  } finally {
    await closeApp(app)
  }
})
