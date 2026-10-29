import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, closeBounded, createSandbox, launchApp, type Sandbox, QUIT_BUDGET_MS } from './helpers'

const SCREENS = 'test-results/screens'
const NEW_IN_SMOKE = /^New (Claude|Codex) session in Smoke$/
const SESSION = 'sess-ops-1'

function writeSession(sandbox: Sandbox): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${SESSION}.json`),
    JSON.stringify({
      pid: process.pid,
      sessionId: SESSION,
      cwd: sandbox.projectFolder,
      name: 'Ops session',
      nameSource: 'user',
      status: 'idle',
      startedAt: now + 1000,
      updatedAt: now + 1000
    }),
    'utf8'
  )
}

function writeOps(sandbox: Sandbox, extra: Record<string, unknown> = {}): void {
  const now = Date.now()
  mkdirSync(sandbox.opsDir, { recursive: true })
  const snapshot = {
    v: 1,
    sessionId: SESSION,
    cwd: sandbox.projectFolder,
    updatedAt: now,
    ended: false,
    model: 'claude-opus-5-5',
    plan: { title: 'Allow editing own messages', done: 3, total: 6 },
    agents: [
      { id: 'a1', description: 'Read existing edit handlers', type: 'worker', model: 'claude-haiku-4-5', status: 'done', startedAt: now - 60_000, finishedAt: now - 46_000, tokens: 12_000, tools: 3 },
      { id: 'a2', description: 'Unit tests for EditMessage', type: 'worker', model: 'claude-sonnet-5-5', status: 'running', startedAt: now - 48_000, tokens: 0, tools: 7, lastStep: 'Bash dotnet test --filter Edit' },
      { id: 'a3', description: 'Localization keys en/ar', type: 'worker', model: 'claude-haiku-4-5', status: 'running', startedAt: now - 9000, tools: 2, lastStep: 'Edit Cultures/ar/Chat.json' },
      { id: 'task-4', description: 'Review the diff', status: 'waiting' }
    ],
    advisor: { status: 'done', verdict: 'OK with notes', note: 'check the soft-delete filter', description: 'Review plan' },
    context: { percent: 41, tokens: 82_000, window: 200_000, stage: 'fine' },
    compactions: 1,
    cache: { phase: 'warm', leftMs: 2_820_000, hitPercent: 96 },
    limits: [
      { kind: 'five_hour', percentUsed: 62, resetsAt: new Date(now + 100 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(now + 4 * 86_400_000).toISOString() },
      { kind: 'seven_day_fable', percentUsed: 9, resetsAt: new Date(now + 3 * 86_400_000).toISOString() }
    ],
    files: [
      { path: 'C:\\work\\Message.cs', kind: 'M', by: 'claude-sonnet-5-5', at: now },
      { path: 'C:\\work\\EditMessageCommand.cs', kind: 'A', by: 'claude-sonnet-5-5', at: now }
    ],
    checks: [
      { kind: 'build', target: 'acme-web', ok: true, summary: 'Build succeeded', at: now - 120_000 },
      { kind: 'test', target: 'acme-web', ok: true, summary: '41 passed  0 failed', at: now - 60_000 }
    ],
    ...extra
  }
  writeFileSync(join(sandbox.opsDir, `${SESSION}.json`), JSON.stringify(snapshot), 'utf8')
}

test('ops feed: strip, details panel, updates, stale and ended', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.info-plan')).toHaveCount(0)

    writeSession(sandbox)
    writeOps(sandbox)
    const strip = page.locator('.pane-info')
    await expect(page.locator('.info-plan')).toHaveText('▸ 3/6', { timeout: 15_000 })
    await expect(page.locator('.info-model')).toHaveText('Opus 5.5')
    await expect(page.locator('.info-model')).toHaveClass(/fam-opus/)
    await expect(page.locator('.info-gauge')).toHaveText('41%')
    await expect(page.locator('.info-gauge .charge')).toHaveAttribute('data-filled', '4')
    await expect(strip.locator('.info-running, .info-letters')).toHaveCount(0)
    await expect(strip).not.toContainText('running')
    await expect(page.locator('[data-limit="five_hour"]')).toContainText('5h 62%')
    await expect(page.locator('.topbar-limits .charge')).toHaveCount(3)
    await expect(page.locator('[data-limit="seven_day_fable"] .limit-label')).toHaveText('fable')
    await expect(page.locator('[data-limit="seven_day_fable"] .limit-label')).toHaveClass(/fam-fable/)

    await expect(page.locator('.agents-toggle')).toHaveCount(0)
    await expect(page.locator('.agents-drawer')).toHaveCount(0)
    await page.getByRole('button', { name: 'Maximize pane' }).click()
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    await expect(page.locator('.pane-details')).toBeHidden()
    await strip.click({ position: { x: 4, y: 10 } })
    const details = page.locator('.pane-details')
    await expect(details).toBeVisible()
    await expect(details.locator('h3')).toHaveText(['Plan', 'Advisor', 'Context', 'Limits', 'Files', 'Checks'])
    await expect(details).toContainText('3 of 6 done')
    await expect(details).toContainText('82k of 200k')
    await expect(details).toContainText('1 compaction')
    await expect(details).toContainText('warm')
    await expect(details).toContainText('96% hit')
    await expect(details).toContainText('resets in 1h')
    await expect(details.locator('.kind-M')).toHaveText('M')
    await expect(details.locator('.kind-A')).toHaveText('A')
    await expect(details).toContainText('Message.cs')
    await expect(details).toContainText('Last build')
    await expect(details).toContainText('41 passed  0 failed')
    await expect(details.locator('.details-footer')).toContainText('From the ops mod in this session · updated')
    await page.screenshot({ path: join(SCREENS, '17-ops-details.png') })

    writeOps(sandbox, { plan: { title: 'Allow editing own messages', done: 4, total: 6 } })
    await expect(page.locator('.info-plan')).toHaveText('▸ 4/6', { timeout: 15_000 })
    await expect(details).toContainText('4 of 6 done')

    writeOps(sandbox, { updatedAt: Date.now() - 12 * 60_000 })
    await expect(details.locator('.details-footer')).toContainText('updated 12m ago', { timeout: 15_000 })
    await expect(page.locator('.info-plan')).toHaveText('▸ 3/6')

    await page.keyboard.press('Escape')
    await expect(details).toBeHidden()
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('.pane.maximized')).toHaveCount(0)

    await page.locator('.pane-actions').click()
    await page.getByRole('menuitem', { name: 'Details' }).click()
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    await expect(details).toBeVisible()
    await details.getByRole('button', { name: 'Close details' }).click()
    await expect(details).toBeHidden()

    writeOps(sandbox, { ended: true })
    await expect(page.locator('.info-plan')).toHaveCount(0, { timeout: 15_000 })
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('details panel without a snapshot explains what the ops mod adds', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await page.getByRole('button', { name: 'Maximize pane' }).click()
    await page.locator('.pane-actions').click()
    await page.getByRole('menuitem', { name: 'Details' }).click()
    const details = page.locator('.pane-details')
    await expect(details).toBeVisible()
    await expect(details).toContainText('The ops mod adds plan, agents, files and checks to this panel.')
    await expect(page.locator('.agents-toggle')).toHaveCount(0)
  } finally {
    await closeBounded(app)
  }
})
