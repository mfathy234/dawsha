import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, createSandbox, launchApp } from './helpers'

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

async function openPanes(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Control+n')
    await expect(page.locator('.quickpick')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(index + 1, { timeout: 20_000 })
  }
}

const termId = async (page: Page, index: number): Promise<string> => (await page.locator('.pane').nth(index).locator('.term-host').first().getAttribute('data-term-id')) ?? ''

async function paneMenu(page: Page, index: number, item: string): Promise<void> {
  await page.locator('.pane').nth(index).getByRole('button', { name: 'Pane actions' }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

test('a note shows in the tooltip, and a snoozed session leaves the layout until it is woken', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openPanes(page, 2)
    const paneId = (await page.locator('.pane').nth(0).getAttribute('data-pane-id')) ?? ''

    await paneMenu(page, 0, 'Add note…')
    const noteDialog = page.getByRole('dialog', { name: 'Add note' })
    await noteDialog.getByRole('textbox').fill('test with the 40k-row tenant')
    await noteDialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator(`.sess-row`).first()).toHaveAttribute('title', /Next: test with the 40k-row tenant/)
    await expect.poll(() => (readSettings(sandbox.userData).workspace?.panes ?? []).map((pane: any) => pane.care?.note?.text)).toContain('test with the 40k-row tenant')

    await paneMenu(page, 0, 'Snooze…')
    const snooze = page.getByRole('dialog', { name: /^Snooze/ })
    await expect(snooze.locator('.care-choice')).toHaveText(['1 hour', 'Tomorrow 9:00', 'Until it needs me'])
    await snooze.getByRole('button', { name: '1 hour' }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator(`.pane[data-pane-id="${paneId}"]`)).toHaveCount(0)
    const fold = page.getByRole('button', { name: 'Snoozed (1)' })
    await expect(fold).toBeVisible()
    await expect.poll(() => (readSettings(sandbox.userData).workspace?.panes ?? []).some((pane: any) => pane.care?.snooze?.kind === 'time')).toBe(true)

    await fold.click()
    await expect(page.locator('.snoozed-row')).toContainText('1 hour')
    await page.getByRole('button', { name: /^Wake / }).click()
    await expect(page.locator('.pane')).toHaveCount(2)
    await expect(page.getByRole('button', { name: /Snoozed/ })).toHaveCount(0)
    await expect.poll(() => (readSettings(sandbox.userData).workspace?.panes ?? []).some((pane: any) => pane.care?.snooze)).toBe(false)
  } finally {
    await closeApp(app)
  }
})

test('send to several sessions shows the exact count and types the message into each', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openPanes(page, 2)
    const ids = [await termId(page, 0), await termId(page, 1)]
    await page.keyboard.press('Control+k')
    await page.locator('#palette-input').fill('send to several')
    await page.getByRole('option', { name: /Send to several sessions/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Send to several sessions' })
    const send = dialog.getByRole('button', { name: /^Send to/ })
    await expect(send).toBeDisabled()
    await dialog.getByLabel('Message').fill('echo broadcast-check')
    await dialog.getByRole('button', { name: 'All', exact: true }).click()
    await expect(dialog.locator('.broadcast-count')).toHaveText('2 of 2 selected')
    await expect(send).toHaveText('Send to 2 sessions')
    await dialog.getByRole('checkbox').first().uncheck()
    await expect(send).toHaveText('Send to 1 session')
    await send.click()
    await expect(page.locator('.toast')).toContainText('Sent to 1 session')
    await expect.poll(async () => (await Promise.all(ids.map((id) => bufferText(page, id)))).filter((text) => text.includes('broadcast-check')).length).toBe(1)
  } finally {
    await closeApp(app)
  }
})
