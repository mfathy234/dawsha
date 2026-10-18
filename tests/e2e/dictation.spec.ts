import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { activeTermId, bufferText, closeApp, createSandbox, launchApp, lastInput, QUIT_BUDGET_MS } from './helpers'

const SLOW = 30_000
const ECHO = resolve(__dirname, '../support/echoInput.cjs')
const ARABIC = 'مرحبا بالعالم'
const flat = async (page: Page, id: string): Promise<string> => (await bufferText(page, id)).replace(/[\r\n]/g, '')
const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

const useFakeEngine = (page: Page, text: string): Promise<void> =>
  page.evaluate((fixed) => { (window as unknown as { __dictationTest: { fake: unknown } }).__dictationTest.fake = { text: fixed } }, text)

async function startEcho(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
  const id = await activeTermId(page)
  await expect.poll(() => flat(page, id), { timeout: 20_000 }).toContain('echo-input ready')
  return id
}

const launch = (sandbox: ReturnType<typeof createSandbox>) =>
  launchApp(sandbox, { DAWSHA_CLAUDE_COMMAND: process.execPath, DAWSHA_CLAUDE_ARGS: JSON.stringify([ECHO]) })

test('the pane mic button records, then types the transcript into the terminal without pressing Enter', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launch(sandbox)
  try {
    const id = await startEcho(page)
    await useFakeEngine(page, ARABIC)
    const mic = page.locator('.pane-mic')
    await expect(mic).toBeVisible()
    await expect(mic).not.toHaveClass(/recording/)

    await mic.click()
    await expect(mic).toHaveClass(/recording/)
    await expect(page.locator('.pane-dictation')).toContainText('Listening')

    await mic.click()
    await expect.poll(() => flat(page, id), { timeout: SLOW }).toContain(`GOT "${ARABIC}"`)
    await expect(mic).not.toHaveClass(/recording/)
    await expect(page.locator('.pane-dictation')).toBeHidden()
    expect(await lastInput(page, id)).toBe(ARABIC)
    expect(await lastInput(page, id)).not.toContain('\r')
    await expect(page.locator('.toast').last()).toContainText('Press Enter to send it')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('Ctrl+Shift+Space dictates, Escape cancels, and the palette lists Dictate', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launch(sandbox)
  try {
    const id = await startEcho(page)
    await useFakeEngine(page, ARABIC)
    await page.locator('.term-host.active').click()

    await page.keyboard.press('Control+Shift+Space')
    await expect(page.locator('.pane-mic')).toHaveClass(/recording/)
    await page.keyboard.press('Escape')
    await expect(page.locator('.pane-mic')).not.toHaveClass(/recording/)
    await page.waitForTimeout(300)
    expect(await bufferText(page, id)).not.toContain(ARABIC)

    await page.keyboard.press('Control+Shift+Space')
    await expect(page.locator('.pane-mic')).toHaveClass(/recording/)
    await page.keyboard.press('Control+Shift+Space')
    await expect.poll(() => flat(page, id), { timeout: SLOW }).toContain(`GOT "${ARABIC}"`)

    await page.keyboard.press('Control+k')
    await page.getByRole('dialog').getByRole('combobox').fill('dictate')
    await expect(page.getByRole('dialog').getByText('Ctrl+Shift+Space')).toBeVisible()
    await page.keyboard.press('Escape')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('dictation goes into the focused text box at the caret, not the terminal', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launch(sandbox)
  try {
    const id = await startEcho(page)
    await useFakeEngine(page, ARABIC)
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await page.getByRole('tab', { name: 'Snippets' }).click()
    await page.locator('#add-snippet').click()
    const dialog = page.getByRole('dialog', { name: 'New snippet' })
    const text = dialog.getByLabel('Text')
    await text.fill('before after')
    await text.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(7, 7))
    await text.focus()

    await page.keyboard.press('Control+Shift+Space')
    await expect(page.locator('.dictation-pill')).toContainText('Listening')
    await page.keyboard.press('Control+Shift+Space')
    await expect(text).toHaveValue(`before ${ARABIC}after`)
    await expect(dialog.locator('.snippet-preview')).toHaveText(`before ${ARABIC}after`)
    await expect(text).toBeFocused()
    expect(await bufferText(page, id)).not.toContain(ARABIC)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('the language and model settings are shown, saved and sanitized', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launch(sandbox)
  try {
    await page.locator('#settings-button').click()
    await expect(page.locator('#dictation-heading')).toBeVisible()
    await expect(page.locator('#dictation-language')).toHaveValue('auto')
    await expect(page.locator('#dictation-model')).toHaveValue('turbo')
    await expect(page.locator('#dictation-model-note')).toContainText('works offline')
    await page.locator('#dictation-language').selectOption('ar')
    await page.locator('#dictation-model').selectOption('small')
    await expect.poll(() => readSettings(sandbox.userData).dictation).toEqual({ language: 'ar', model: 'small' })
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
