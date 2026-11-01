import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'
import { writeOps } from '../screenshots/harness'

const SESSION_ID = '7c1e04b2-5d3a-4f10-9a2e-1b8c6d4e0f01'

test('top bar shows the brand and the split New session button picks the agent', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    // CI's window is 1024px wide, which would show the compact top bar.
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page).toHaveTitle('Dawsha')
    await expect(page.locator('.app-title')).toHaveText('Dawsha')
    await expect(page.locator('.app-logo svg')).toBeVisible()

    const chevron = page.locator('#new-session-agent')
    const newSession = page.locator('#new-session')
    await expect(newSession).toHaveAttribute('aria-haspopup', 'menu')
    await expect(newSession).toHaveAttribute('aria-expanded', 'false')
    await chevron.click()
    await expect(newSession).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menuitem')).toHaveText([/Claude session$/, /Codex session$/, /Gemini session$/, 'Resume a session…Ctrl+Shift+R', 'Ask two agents…Ctrl+Shift+A', 'Hand a job to an agent…'])
    await expect(page.getByRole('menuitem', { name: /Claude session/ })).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: /Codex session/ })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(newSession).toHaveAttribute('aria-expanded', 'false')

    await chevron.click()
    await page.getByRole('menuitem', { name: /Gemini session/ }).click()
    await expect(page.locator('.quickpick')).toBeVisible()
    await expect(page.locator('.quickpick .option').first()).toContainText('Gemini')
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['gemini'])

    await page.locator('#new-session').click()
    await expect(page.locator('.quickpick .option').first()).toContainText('Claude')
  } finally {
    await closeApp(app)
  }
})

test('compact header keeps New session as a + button, the View menu and Settings usable at 960px', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.setViewportSize({ width: 960, height: 600 })
    const newSession = page.locator('.topbar').getByRole('button', { name: 'New session', exact: true })
    await expect(newSession).toBeVisible()
    await expect(newSession.locator('.new-session-label')).toBeHidden()
    for (const name of ['View', 'Settings']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(page.locator('#files-button .nav-label')).toBeHidden()
    await expect(page.locator('#sessions-button .nav-label')).toBeVisible()
    expect(await page.locator('.topbar').evaluate((bar) => bar.scrollWidth <= bar.clientWidth)).toBe(true)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.locator('.settings-view')).toBeVisible()
    await page.locator('#settings-tab-appearance').click()
    await page.locator('#settings-theme-picker').click()
    await expect(page.locator('.theme-picker')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await newSession.click()
    await expect(page.locator('.quickpick')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('the top bar never pushes out its icons with the usage limits shown', async () => {
  const sandbox = createSandbox()
  const now = Date.now()
  const slug = sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-')
  const dir = join(sandbox.claudeHome, 'projects', slug)
  mkdirSync(dir, { recursive: true })
  const iso = (minutes: number): string => new Date(now - minutes * 60_000).toISOString()
  writeFileSync(join(dir, `${SESSION_ID}.jsonl`), JSON.stringify({ type: 'user', timestamp: iso(30), cwd: sandbox.projectFolder, message: { content: 'Polish the release' } }) + '\n')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: /^New (Claude|Codex|Gemini) session in Smoke$/ }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    writeFileSync(join(sandbox.sessionsDir, 'smoke.json'), JSON.stringify({ pid: process.pid, sessionId: SESSION_ID, cwd: sandbox.projectFolder, name: 'Polish the release', nameSource: 'user', status: 'busy', startedAt: now + 1000, updatedAt: now + 1000 }), 'utf8')
    writeOps(sandbox)
    // The limits hide below 1220px, and CI's window is about 1024px wide.
    await page.setViewportSize({ width: 1600, height: 900 })
    await expect(page.locator('.topbar-limits')).toBeVisible({ timeout: 20_000 })
    // The old running-agents badge on the Agents tab is gone: the crew strip replaces it.
    const navHeight = (await page.locator('#files-button').boundingBox())!.height
    for (const width of [1600, 1440, 1280, 1024, 960]) {
      await page.setViewportSize({ width, height: 900 })
      const box = (await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
      if (width >= 1280) await expect(page.locator('.topbar-limits')).toBeVisible()
      expect((await page.locator('#background-button').boundingBox())!.height).toBeCloseTo(navHeight, 0)
      expect(await page.locator('.topbar').evaluate((bar) => bar.scrollWidth <= bar.clientWidth)).toBe(true)
    }
  } finally {
    await closeApp(app)
  }
})
