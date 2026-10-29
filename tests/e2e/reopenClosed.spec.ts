import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openTerminalPicker } from './helpers'

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
const CLAUDE_ID = '11111111-2222-4333-8444-555555555555'

test('closing an agent session offers Reopen for a few seconds and brings it back in its slot; shells get none', async () => {
  const sandbox = createSandbox()
  const dir = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${CLAUDE_ID}.jsonl`),
    [
      JSON.stringify({ type: 'user', timestamp: '2026-10-08T09:12:00.000Z', message: { content: 'Add a dark mode toggle' } }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Add dark mode toggle' })
    ].join('\n') + '\n'
  )
  const { app, page } = await launchApp(sandbox)
  try {
    // Pane 1 is a resumed Claude session, pane 2 a fresh one.
    await page.keyboard.press('Control+Shift+R')
    await page.locator('.rp-row', { hasText: 'Add dark mode toggle' }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(2)
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.[0]?.tabs?.[0]?.sessionId).toBe(CLAUDE_ID)
    const secondId = await page.locator('.pane').nth(1).getAttribute('data-pane-id')

    await page.locator('.pane').first().getByRole('button', { name: 'Close pane' }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    const toast = page.locator('.toast')
    await expect(toast).toHaveText('Closed SmokeReopen')
    await toast.getByRole('button', { name: 'Reopen' }).click()
    await expect(toast).toHaveCount(0)
    await expect(page.locator('.pane')).toHaveCount(2)
    // Back in the first slot, resumed by its own session id.
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.[0]?.tabs?.[0]?.sessionId).toBe(CLAUDE_ID)
    expect(await page.locator('.pane').nth(1).getAttribute('data-pane-id')).toBe(secondId)
    await expect(page.locator('.pane').first().locator('.chip-resumed')).toBeVisible()

    // A shell terminal has no session to come back to: closing it shows no Reopen.
    await openTerminalPicker(page.locator('.pane').nth(1))
    await page.getByRole('menuitem', { name: 'Shell' }).click()
    await expect(page.locator('.pane').nth(1).locator('.tabs [role="tab"]')).toHaveCount(2)
    await page.locator('.pane').nth(1).getByRole('button', { name: /^Close terminal/ }).click()
    await expect(page.locator('.pane').nth(1).locator('.tabs [role="tab"]')).toHaveCount(1)
    await expect(page.locator('.toast')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
