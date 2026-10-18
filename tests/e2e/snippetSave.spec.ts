import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, launchApp } from './helpers'

const SCREENS = 'test-results/screens'
const REPLY = 'SNAP-REPLY run the billing tests before you push'

const readSnippets = (userData: string): { name: string; text: string }[] =>
  JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).snippets ?? []

const selectLine = (page: Page, id: string, text: string): Promise<boolean> =>
  page.evaluate(
    ([termId, needle]) => (window as unknown as { __grid: { selectLine(id: string, t: string): boolean } }).__grid.selectLine(termId, needle),
    [id, text]
  )

test('save selection as snippet from the pane menu works on a short window, by keyboard, and reports a failed write', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    // Shorter than the snippet dialog, as on a small laptop screen with display scaling.
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setMinimumSize(0, 0)
      window.setContentSize(1280, 480)
    })
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThan(560)
    const height = await page.evaluate(() => window.innerHeight)
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const id = (await page.locator('.term-host.active').getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
    await feedTerminal(page, id, `\r\n${REPLY}\r\n`)
    await expect.poll(() => bufferText(page, id)).toContain(REPLY)

    // A failed settings write keeps the dialog open and says why.
    const blocker = join(sandbox.userData, 'settings.json.tmp')
    mkdirSync(blocker)
    expect(await selectLine(page, id, 'SNAP-REPLY')).toBe(true)
    await page.locator('.pane-actions').first().click()
    await page.getByRole('menuitem', { name: /Save selection as snippet/ }).click()
    const dialog = page.getByRole('dialog', { name: 'New snippet' })
    await expect(dialog).toBeVisible()
    const save = dialog.getByRole('button', { name: 'Save snippet' })
    await save.scrollIntoViewIfNeeded()
    const box = (await save.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(height)
    expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(height)
    await page.screenshot({ path: join(SCREENS, 'snippet-dialog-short-window.png') })
    await save.click()
    await expect(dialog.locator('.field-error')).toHaveText(/^Could not save the snippet\. Path is a directory/)
    await expect(dialog).toBeVisible()
    expect(readSnippets(sandbox.userData)).toEqual([])

    // Enter in the name field saves once the write can succeed.
    rmSync(blocker, { recursive: true })
    await dialog.getByLabel('Name').press('Enter')
    await expect(dialog).toBeHidden()
    await expect.poll(() => readSnippets(sandbox.userData).map((s) => s.text)).toEqual([REPLY])

    // Ctrl+Enter in the text saves a new snippet, and a missing name is reported on its field.
    await page.keyboard.press('Control+k')
    await page.getByPlaceholder('Type a command, a session or a project').fill('New snippet')
    await page.getByRole('option', { name: /^New snippet/ }).click()
    await dialog.getByLabel('Text').fill('say hello')
    await dialog.getByLabel('Text').press('Control+Enter')
    await expect(dialog.locator('.field-error')).toHaveText('Enter a name.')
    await expect(dialog.getByLabel('Name')).toBeFocused()
    await dialog.getByLabel('Name').fill('hello')
    await dialog.getByLabel('Text').press('Control+Enter')
    await expect(dialog).toBeHidden()
    await expect.poll(() => readSnippets(sandbox.userData).map((s) => s.name)).toEqual(['SNAP-REPLY run the billing tests', 'hello'])
  } finally {
    await closeApp(app)
  }
})
