import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const SCREENS = 'test-results/screens'
const NEW_IN_SMOKE = /^New (Claude|Codex|Gemini) session in Smoke$/
const SESSION = 'sess-close-1'
const LONG_NAME =
  'Refactor the invoice export so that query, format and write are separate steps and add tests for every edge case we found last week'

function writeSession(sandbox: Sandbox, status: string): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${SESSION}.json`),
    JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, name: LONG_NAME, nameSource: 'user', status, startedAt: now + 1000, updatedAt: now + 1000 }),
    'utf8'
  )
}

test('asks before closing only while the session is working, with a short title that fits', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    const pane = page.locator('.pane')
    writeSession(sandbox, 'busy')
    await expect(pane.locator('.pane-state')).toContainText('Working', { timeout: 15_000 })

    await page.getByRole('button', { name: 'Close pane' }).click()
    const dialog = page.getByRole('alertdialog')
    const heading = dialog.getByRole('heading')
    await expect(heading).toHaveText('Close “Refactor the invoice export so that…”?')
    await expect(dialog).toContainText('Claude is still working on it in Smoke.')
    const confirm = dialog.getByRole('button', { name: 'Close “Refactor the invoice…”' })
    await expect(confirm).toBeVisible()
    // The dialog keeps its width, and the button stays inside it on one line.
    const box = (await dialog.boundingBox())!
    const button = (await confirm.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(460)
    expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width)
    expect(button.height).toBeLessThanOrEqual(40)
    const cancel = (await dialog.getByRole('button', { name: 'Cancel' }).boundingBox())!
    expect(Math.abs(cancel.y - button.y)).toBeLessThan(2)
    await page.screenshot({ path: join(SCREENS, '5-close-confirm.png') })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(pane).toHaveCount(1)

    writeSession(sandbox, 'idle')
    await expect(pane.locator('.pane-state')).not.toContainText('Working', { timeout: 15_000 })
    await page.getByRole('button', { name: 'Close pane' }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(pane).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
