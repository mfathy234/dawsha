import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openMore } from './helpers'

const dialog = (page: Page) => page.locator('.overlay:not(.leaving) .dialog')
const confirmButton = (page: Page) => page.locator('.overlay:not(.leaving) [role="alertdialog"] [data-confirm]')

async function openScheduled(page: Page): Promise<void> {
  await openMore(page, 'work')
  await page.locator('#work-mode-scheduled').click()
  await expect(page.locator('#schedule-section')).toBeVisible()
}

test('scheduled runs can be added, edited and deleted with a named confirmation', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openScheduled(page)
    await expect(page.locator('#schedule-section')).toContainText('Runs only while Dawsha is open.')
    await page.locator('#schedule-add').click()
    await dialog(page).locator('textarea').fill('Run the test suite')
    await dialog(page).locator('input[type="text"]').fill('Nightly tests')
    await dialog(page).getByRole('button', { name: 'Add schedule' }).click()
    const row = page.locator('#schedule-list li')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Nightly tests')
    await expect(row).toContainText('Mon, Tue, Wed, Thu, Fri at 09:00')
    await expect(row).toContainText('Last run: none yet')

    await row.getByRole('button', { name: 'Edit Nightly tests' }).click()
    await dialog(page).locator('input[type="text"]').fill('Nightly checks')
    await dialog(page).getByRole('button', { name: 'Save schedule' }).click()
    await expect(row).toContainText('Nightly checks')

    await row.getByRole('button', { name: 'Delete Nightly checks' }).click()
    await expect(confirmButton(page)).toHaveText('Delete Nightly checks')
    await expect(page.locator('.overlay:not(.leaving) [role="alertdialog"]')).toContainText('"Nightly checks"')
    await page.locator('.overlay:not(.leaving) [role="alertdialog"]').getByRole('button', { name: 'Cancel' }).click()
    await expect(row).toHaveCount(1)
    await row.getByRole('button', { name: 'Delete Nightly checks' }).click()
    await confirmButton(page).click()
    await expect(page.locator('#schedule-list')).toHaveCount(0)
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).scheduledRuns).toEqual([])
  } finally { await closeApp(app) }
})

test('queued tasks can be added, reordered and removed with a named confirmation', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await openScheduled(page)
    await expect(page.locator('#queue-start')).toBeDisabled()
    for (const text of ['First task', 'Second task']) {
      await page.locator('#queue-add').click()
      await dialog(page).locator('textarea').fill(text)
      await dialog(page).getByRole('button', { name: 'Add to queue' }).click()
    }
    const names = page.locator('#queue-list .work-ticket-name')
    await expect(names).toHaveText(['First task', 'Second task'])
    await page.getByRole('button', { name: 'Move Second task up' }).click()
    await expect(names).toHaveText(['Second task', 'First task'])
    await expect(page.locator('#queue-start')).toBeEnabled()

    await page.getByRole('button', { name: 'Remove First task' }).click()
    await expect(confirmButton(page)).toHaveText('Remove First task')
    await confirmButton(page).click()
    await expect(names).toHaveText(['Second task'])
  } finally { await closeApp(app) }
})

test('a one-time run missed while Dawsha was closed starts once at startup and links to its pane', async () => {
  const sandbox = createSandbox()
  const now = Date.now()
  const path = join(sandbox.userData, 'settings.json')
  const settings = JSON.parse(readFileSync(path, 'utf8'))
  settings.scheduledRuns = [{
    id: 'once1', name: 'Missed run', projectId: 'smoke', agent: 'claude', prompt: 'echo scheduled', days: [], hour: 0, minute: 0,
    onceAt: now - 10 * 60_000, worktree: false, lastCheckedAt: now - 60 * 60_000, runs: []
  }]
  writeFileSync(path, JSON.stringify(settings), 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    await openScheduled(page)
    const row = page.locator('#schedule-list li')
    await expect(row).toContainText('Last run:')
    await expect(row).toContainText('started')
    await expect(row).toContainText('Next run: none')
    await expect(page.locator('.pane')).toHaveCount(1)
    await row.getByRole('button', { name: 'Open the pane of Missed run' }).click()
    await expect(page.locator('.pane')).toBeVisible()
    const saved = JSON.parse(readFileSync(path, 'utf8')).scheduledRuns[0]
    expect(saved.runs).toHaveLength(1)
  } finally { await closeApp(app) }
})
