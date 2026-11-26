import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, createSandbox, feedTerminal, launchApp, openSettings } from './helpers'

const PROMPT = ['  npm test -- invoices', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

const away = (app: ElectronApplication, change: { away: boolean; since: number }): Promise<void> =>
  app.evaluate(({ BrowserWindow }, value) => { BrowserWindow.getAllWindows()[0].webContents.send('away:changed', value) }, change)

async function openPanes(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Control+n')
    await expect(page.locator('.quickpick')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(index + 1, { timeout: 20_000 })
  }
}

async function needsYou(page: Page): Promise<void> {
  const termId = (await page.locator('.pane').first().locator('.term-host').first().getAttribute('data-term-id')) ?? ''
  await expect(async () => {
    await feedTerminal(page, termId, '\r\n' + PROMPT)
    await expect(page.locator('.pane').first()).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
  }).toPass({ timeout: 30_000 })
}

test('after 20 minutes away a card lists what needs you, and Open inbox goes to the inbox', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchApp(createSandbox())
  try {
    await openPanes(page, 2)
    const since = Date.now() - 30 * 60_000
    await away(app, { away: true, since })
    await needsYou(page)
    await away(app, { away: false, since })
    const card = page.getByRole('dialog', { name: 'While you were away' })
    await expect(card).toBeVisible()
    await expect(card.locator('.catchup-headline')).toContainText('30m')
    await expect(card.locator('.catchup-row')).toHaveCount(1)
    await expect(card.locator('.catchup-state')).toContainText('Needs you')
    await card.getByRole('button', { name: 'Open inbox' }).click()
    await expect(page.locator('.inbox-view')).toBeVisible()
    await expect(page.locator('.inbox-row')).toHaveCount(1)
  } finally {
    await closeApp(app)
  }
})

test('a short absence shows nothing, and the setting turns the card off', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openPanes(page, 2)
    const short = Date.now() - 5 * 60_000
    await away(app, { away: true, since: short })
    await needsYou(page)
    await away(app, { away: false, since: short })
    await page.waitForTimeout(800)
    await expect(page.locator('.catchup-dialog')).toHaveCount(0)

    await openSettings(page, 'notifications')
    const toggle = page.locator('#catch-up-toggle')
    await expect(toggle).toBeChecked()
    await toggle.uncheck()
    await expect.poll(() => readSettings(sandbox.userData).catchUp).toBe(false)
    const long = Date.now() - 45 * 60_000
    await away(app, { away: true, since: long })
    await away(app, { away: false, since: long })
    await page.waitForTimeout(800)
    await expect(page.locator('.catchup-dialog')).toHaveCount(0)
    await toggle.check()
    await expect.poll(() => readSettings(sandbox.userData).catchUp).toBe(true)
    await away(app, { away: true, since: long })
    await away(app, { away: false, since: long })
    await expect(page.locator('.catchup-dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Dismiss', exact: true }).last().click()
    await expect(page.locator('.catchup-dialog')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
