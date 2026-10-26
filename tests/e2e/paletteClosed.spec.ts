import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, QUIT_BUDGET_MS } from './helpers'

const SCREENS = 'test-results/screens'
const OLD = '00000000-0000-4000-8000-000000000201'
const NEW = '00000000-0000-4000-8000-000000000202'

test('the command palette lists closed sessions newest first and resumes the one you pick', async () => {
  const sandbox = createSandbox()
  const settings = JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))
  const now = Date.now()
  const keptSessions = [
    { projectId: 'smoke', agent: 'claude', sessionId: OLD, title: 'Rotate the Zebra keys', closedAt: now - 3 * 86_400_000 },
    { projectId: 'smoke', agent: 'codex', sessionId: NEW, title: 'Tidy invoice totals', closedAt: now - 2 * 3_600_000 }
  ]
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ ...settings, keptSessions }), 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.keyboard.press('Control+k')
    await expect(page.locator('#palette-input')).toBeFocused()
    await expect(page.locator('.palette-group')).toContainText(['Closed sessions'])
    const rows = page.locator('.palette-row[data-command^="closed:"]')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Tidy invoice totals')
    await expect(rows.first().locator('.palette-hint')).toHaveText('Smoke · 2h')
    await expect(rows.last().locator('.palette-hint')).toHaveText('Smoke · 3d')
    await page.screenshot({ path: join(SCREENS, '162-palette-closed.png') })

    await page.keyboard.type('zebra')
    await expect(page.locator('.palette-group')).toHaveText(['Closed sessions'])
    await expect(page.locator('.palette-row')).toHaveCount(1)
    await expect(page.locator('.palette-row')).toContainText('Rotate the Zebra keys')
    await page.keyboard.press('Enter')
    await expect(page.locator('#palette-input')).toHaveCount(0)
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).workspace?.panes?.[0]?.tabs?.[0]?.sessionId).toBe(OLD)

    await page.keyboard.press('Control+k')
    await expect(page.locator('.palette-row[data-command^="closed:"]')).toHaveCount(1)
    await expect(page.locator('.palette-row[data-command="closed:claude:' + OLD + '"]')).toHaveCount(0)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
