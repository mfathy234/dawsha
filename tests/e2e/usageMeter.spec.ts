import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const SCREENS = 'test-results/screens'
const SESSION = 'sess-meter-1'

function writeCodexRollout(sandbox: Sandbox): void {
  const now = Date.now()
  const dir = join(sandbox.codexHome, 'sessions', '2026', '10', '29')
  mkdirSync(dir, { recursive: true })
  const meta = { timestamp: new Date(now - 60_000).toISOString(), type: 'session_meta', payload: { id: '019a0000-0000-7000-8000-000000000001', timestamp: new Date(now - 60_000).toISOString(), cwd: sandbox.projectFolder } }
  const limits = (primary: unknown, secondary: unknown, at: number) =>
    ({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { primary, secondary, plan_type: 'plus' } } })
  const lines = [
    meta,
    limits({ used_percent: 99, window_minutes: 300, resets_at: Math.floor((now + 90 * 60_000) / 1000) }, { used_percent: 15, window_minutes: 10080, resets_at: Math.floor((now + 3 * 86_400_000) / 1000) }, now - 30_000),
    limits(null, null, now - 5_000)
  ]
  const body = lines.map((line) => JSON.stringify(line)).join(String.fromCharCode(10))
  writeFileSync(join(dir, 'rollout-2026-10-29T10-00-00-019a0000-0000-7000-8000-000000000001.jsonl'), body + String.fromCharCode(10), 'utf8')
}

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
    // The full meter shows from 1220px up; the 1024px compact form has its own test below.
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

    writeFileSync(join(sandbox.claudeHome, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'you@example.com', organizationType: 'claude_max' } }), 'utf8')
    await meter.click()
    const popover = page.getByRole('dialog', { name: 'Limits by agent' })
    await expect(popover).toBeVisible()
    await expect(popover.locator('.limits-agent-block[data-agent="claude"] .limits-account')).toHaveText('you@example.com · Max')
    await expect(popover.locator('.limits-agent-block[data-agent="gemini"] .limits-account')).toHaveText('Not signed in')
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
    mkdirSync('C:/Users/tuy_2/Desktop/Work/dawsha-shots', { recursive: true })
    await page.screenshot({ path: 'C:/Users/tuy_2/Desktop/Work/dawsha-shots/limits-accounts.png' })
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

test('at the 1024px CI width the usage meter shows the agent mark and the most urgent window, and nothing in the top bar overlaps', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    const meter = page.locator('#topbar-limits')
    await page.getByRole('button', { name: 'New Claude session in Smoke' }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    writeClaudeLimits(sandbox)
    const compact = meter.locator('.limits-compact')
    await expect(compact).toHaveText('62%', { timeout: 15_000 })
    await expect(meter).toBeVisible()
    await expect(meter.locator('.agent-mark')).toBeVisible()
    await expect(meter.locator('.limits-windows')).toBeHidden()
    await expect(meter).toHaveAttribute('aria-label', /Claude Code limits: 5h: 62% used/)
    await expect(meter).toHaveAttribute('title', /5h: 62% used/)

    const boxes = await page.locator('.topbar > *:visible').evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect()
        return { name: node.id || node.className, left: r.left, right: r.right, width: r.width }
      }).filter((box) => box.width > 0)
    )
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(boxes[i].right <= boxes[j].left + 0.5 || boxes[j].right <= boxes[i].left + 0.5, `${boxes[i].name} overlaps ${boxes[j].name}`).toBe(true)
    const bar = await page.locator('.topbar').boundingBox()
    for (const box of boxes) expect(box.right).toBeLessThanOrEqual((bar?.x ?? 0) + (bar?.width ?? 0) + 0.5)

    await page.screenshot({ path: join(SCREENS, 'usage-meter-1024.png'), clip: { x: 0, y: 0, width: 1024, height: 60 } })
    await meter.click()
    await expect(page.getByRole('dialog', { name: 'Limits by agent' })).toBeVisible()
    await page.keyboard.press('Escape')
  } finally {
    await closeApp(app)
  }
})

test('Codex limits come from its rollout files and show in the meter and the popover', async () => {
  const sandbox = createSandbox()
  writeCodexRollout(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    const meter = page.locator('#topbar-limits')
    await page.getByRole('button', { name: 'Project actions for Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Codex session' }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(meter.locator('.limits-agent')).toContainText('Codex')
    await expect(meter.locator('[data-limit="five_hour"]')).toContainText('5h 99%', { timeout: 15_000 })
    await meter.click()
    const codex = page.getByRole('dialog', { name: 'Limits by agent' }).locator('.limits-agent-block[data-agent="codex"]')
    await expect(codex.locator('[data-limit="five_hour"]')).toContainText('5h')
    await expect(codex.locator('[data-limit="five_hour"]')).toContainText('99%')
    await expect(codex.locator('[data-limit="seven_day"]')).toContainText('week')
    await expect(codex.locator('[data-limit="seven_day"]')).toContainText('15%')
    await expect(codex.locator('.limits-agent-age')).toContainText('updated')
  } finally {
    await closeApp(app)
  }
})

test('with no session open the meter and popover use the last known readings and the most urgent agent leads', async () => {
  const sandbox = createSandbox()
  writeCodexRollout(sandbox)
  const now = Date.now()
  writeFileSync(
    join(sandbox.userData, 'usage-history.json'),
    JSON.stringify({ v: 1, limits: [{ at: now - 2 * 3_600_000, w: { five_hour: 62, seven_day: 18 }, r: { five_hour: now + 3_600_000, seven_day: now + 4 * 86_400_000 } }], costs: {} }),
    'utf8'
  )
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    const meter = page.locator('#topbar-limits')
    await expect(page.locator('.pane')).toHaveCount(0)
    await expect(meter).toBeVisible({ timeout: 15_000 })
    await expect(meter.locator('.limits-agent')).toContainText('Codex')
    await expect(meter.locator('[data-limit="five_hour"]')).toContainText('5h 99%')
    await meter.click()
    const popover = page.getByRole('dialog', { name: 'Limits by agent' })
    const claude = popover.locator('.limits-agent-block[data-agent="claude"]')
    await expect(claude.locator('[data-limit="five_hour"]')).toContainText('62%')
    await expect(claude.locator('[data-limit="seven_day"]')).toContainText('18%')
    await expect(claude.locator('.limits-agent-age')).toContainText('updated 2h ago')
    await expect(popover.locator('.limits-agent-block[data-agent="codex"] [data-limit="five_hour"]')).toContainText('99%')
    await expect(popover.locator('.limits-agent-block[data-agent="gemini"] .limits-agent-age')).toHaveText('no limits reported')
    await page.screenshot({ path: 'C:/Users/tuy_2/Desktop/Work/dawsha-shots/limits-no-session.png' })
  } finally {
    await closeApp(app)
  }
})
