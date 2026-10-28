import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const SCREENS = 'test-results/screens'
const SESSION = 'sess-meter-1'

function writeClaudeLimits(sandbox: Sandbox): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${SESSION}.json`),
    JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, name: 'Meter session', nameSource: 'user', status: 'idle', startedAt: now + 1000, updatedAt: now + 1000 }),
    'utf8'
  )
  mkdirSync(sandbox.opsDir, { recursive: true })
  writeFileSync(
    join(sandbox.opsDir, `${SESSION}.json`),
    JSON.stringify({
      v: 1,
      sessionId: SESSION,
      cwd: sandbox.projectFolder,
      updatedAt: now,
      ended: false,
      model: 'claude-opus-5-5',
      limits: [
        { kind: 'five_hour', percentUsed: 62, resetsAt: new Date(now + 100 * 60_000).toISOString() },
        { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(now + 4 * 86_400_000).toISOString() }
      ]
    }),
    'utf8'
  )
}

test('the usage meter names the focused agent, never borrows another agent numbers, and lists every agent in a popover', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    // The top bar hides the meter below 1220px, and the CI window is about 1024 wide.
    await page.setViewportSize({ width: 1440, height: 900 })
    const meter = page.locator('#topbar-limits')
    await page.getByRole('button', { name: 'New Claude session in Smoke' }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(meter).toContainText('no limits reported')
    writeClaudeLimits(sandbox)
    await expect(meter.locator('[data-limit="five_hour"]')).toContainText('5h 62%', { timeout: 15_000 })
    await expect(meter.locator('.limits-agent')).toContainText('Claude')

    await page.getByRole('button', { name: 'Project actions for Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Codex session' }).click()
    await expect(page.locator('.pane')).toHaveCount(2)
    await expect(meter.locator('.limits-agent')).toContainText('Codex')
    await expect(meter).toContainText('no limits reported')
    await expect(meter.locator('[data-limit]')).toHaveCount(0)

    await meter.click()
    const popover = page.getByRole('dialog', { name: 'Limits by agent' })
    await expect(popover).toBeVisible()
    await expect(popover.locator('.limits-agent-block')).toHaveCount(3)
    const claude = popover.locator('.limits-agent-block[data-agent="claude"]')
    const codex = popover.locator('.limits-agent-block[data-agent="codex"]')
    await expect(claude.locator('[data-limit="five_hour"]')).toContainText('62%')
    await expect(claude.locator('.limits-agent-age')).toContainText('updated')
    await expect(claude.locator('.limits-row-reset').first()).toContainText('resets in')
    await expect(codex.locator('.limits-focused')).toHaveText('focused')
    await expect(codex.locator('.limits-agent-age')).toHaveText('no limits reported')
    await expect(popover.locator('.limits-agent-block[data-agent="gemini"] .limits-agent-age')).toHaveText('no limits reported')
    await page.screenshot({ path: join(SCREENS, 'usage-meter-popover.png') })
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
    await expect(meter).toBeFocused()

    await page.locator('.pane').first().locator('.pane-title').click()
    await expect(meter.locator('.limits-agent')).toContainText('Claude')
    await expect(meter.locator('[data-limit="five_hour"]')).toContainText('5h 62%')

    await meter.click()
    await page.getByRole('button', { name: 'Open Usage' }).click()
    await expect(page.locator('#more-button')).toHaveAttribute('aria-label', /Usage/)
  } finally {
    await closeApp(app)
  }
})
