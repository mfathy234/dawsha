import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openSettings, type Sandbox } from './helpers'

const fixture = JSON.parse(readFileSync(join(__dirname, '../unit/fixtures/statusline-payload.json'), 'utf8'))
const warnings = (file: string): { body: string; sound: boolean }[] => existsSync(file)
  ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(n => n.body.includes('of its')) : []

function claudeLimits(sandbox: Sandbox, five: number, week = 10, reset = Date.now() + 3_600_000): void {
  const dir = join(sandbox.userData, 'status')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'usage-warning.json'), JSON.stringify({ ...fixture, session_id: 'usage-warning', rate_limits: {
    five_hour: { used_percentage: five, resets_at: Math.floor(reset / 1000) },
    seven_day: { used_percentage: week, resets_at: Math.floor((reset + 3 * 86_400_000) / 1000) }
  } }))
}

function codexLimits(sandbox: Sandbox, five: number, week: number): void {
  const dir = join(sandbox.codexHome, 'sessions')
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'rollout-2026-11-14T10-00-00-11111111-2222-4333-8444-555555555555.jsonl'), JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'token_count', rate_limits: {
    primary: { used_percent: five, window_minutes: 300, resets_at: Math.floor(Date.now() / 1000) + 3600 },
    secondary: { used_percent: week, window_minutes: 10080, resets_at: Math.floor(Date.now() / 1000) + 86400 }
  } } }) + '\n')
}

test('Claude warns at 80 and 95 while hidden, dedupes dips and restart, and re-arms on reset', async () => {
  const sandbox = createSandbox()
  const path = join(sandbox.userData, 'settings.json')
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), desktop: { closeBehavior: 'tray' }, sessionInfo: { notifications: true, sound: true } }))
  const reset = Date.now() + 3_600_000
  claudeLimits(sandbox, 79, 10, reset)
  let running = await launchApp(sandbox)
  try {
    await expect.poll(() => running.page.evaluate(async () => (await window.gridApi.knownLimits()).claude?.windows[0]?.percent)).toBe(79)
    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    claudeLimits(sandbox, 82, 10, reset)
    await expect.poll(() => warnings(sandbox.notifyLog).length, { timeout: 20_000 }).toBe(1)
    expect(warnings(sandbox.notifyLog)[0]).toMatchObject({ body: expect.stringMatching(/^Claude is at 82% of its 5-hour limit\. It resets at \d\d:\d\d\.$/), sound: true })
    claudeLimits(sandbox, 96, 10, reset)
    await expect.poll(() => warnings(sandbox.notifyLog).length, { timeout: 20_000 }).toBe(2)
    claudeLimits(sandbox, 79, 10, reset)
    await expect.poll(() => running.page.evaluate(async () => (await window.gridApi.knownLimits()).claude?.windows[0]?.percent)).toBe(79)
    claudeLimits(sandbox, 82, 10, reset)
    await expect.poll(() => running.page.evaluate(async () => (await window.gridApi.knownLimits()).claude?.windows[0]?.percent)).toBe(82)
    await running.page.waitForTimeout(5500)
    expect(warnings(sandbox.notifyLog)).toHaveLength(2)
    await closeApp(running.app)
    running = await launchApp(sandbox)
    await running.page.waitForTimeout(5500)
    expect(warnings(sandbox.notifyLog)).toHaveLength(2)
    claudeLimits(sandbox, 83, 10, reset + 5 * 3_600_000)
    await expect.poll(() => warnings(sandbox.notifyLog).length, { timeout: 20_000 }).toBe(3)
  } finally { await closeApp(running.app) }
})

test('Codex weekly and 5-hour windows warn independently and respect the sound preference', async () => {
  const sandbox = createSandbox()
  codexLimits(sandbox, 82, 96)
  const { app } = await launchApp(sandbox)
  try {
    await expect.poll(() => warnings(sandbox.notifyLog).length, { timeout: 20_000 }).toBe(2)
    expect(warnings(sandbox.notifyLog).map(n => n.body)).toEqual(expect.arrayContaining([
      expect.stringContaining('Codex is at 82% of its 5-hour limit.'),
      expect.stringContaining('Codex is at 96% of its weekly limit.')
    ]))
    expect(warnings(sandbox.notifyLog).every(n => n.sound === false)).toBe(true)
  } finally { await closeApp(app) }
})

test('warning and global notification switches suppress delivery and persist', async () => {
  const sandbox = createSandbox()
  const path = join(sandbox.userData, 'settings.json')
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), warnUsageLimits: false }))
  claudeLimits(sandbox, 82)
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'notifications')
    await expect(page.locator('#usage-warning-toggle')).not.toBeChecked()
    await page.locator('#settings-search').fill('warn me')
    await expect(page.locator('#usage-warning-toggle')).toBeVisible()
    await page.locator('#settings-search').fill('')
    await page.waitForTimeout(5500)
    expect(warnings(sandbox.notifyLog)).toEqual([])
    await page.locator('#usage-warning-toggle').click()
    await expect.poll(() => JSON.parse(readFileSync(path, 'utf8')).warnUsageLimits).toBe(true)
    await expect.poll(() => warnings(sandbox.notifyLog).length, { timeout: 20_000 }).toBe(1)
    await page.locator('#notify-toggle').click()
    await expect(page.locator('#usage-warning-toggle')).toBeDisabled()
    claudeLimits(sandbox, 96)
    await page.waitForTimeout(6500)
    expect(warnings(sandbox.notifyLog)).toHaveLength(1)
    await page.locator('#notify-toggle').click()
    await expect.poll(() => warnings(sandbox.notifyLog).length, { timeout: 20_000 }).toBe(2)
  } finally { await closeApp(app) }
})
