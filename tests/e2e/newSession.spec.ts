import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const SESSION_ID = '7c1e04b2-5d3a-4f10-9a2e-1b8c6d4e0f01'

test('top bar shows the brand and the split New session button picks the agent', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(page).toHaveTitle('Dawsha')
    await expect(page.locator('.app-title')).toHaveText('Dawsha')
    await expect(page.locator('.app-logo svg')).toBeVisible()

    const chevron = page.getByRole('button', { name: 'Choose agent', exact: true })
    await expect(chevron).toHaveAttribute('aria-haspopup', 'menu')
    await expect(chevron).toHaveAttribute('aria-expanded', 'false')
    await chevron.click()
    await expect(chevron).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menuitem')).toHaveText(['Claude session', 'Codex session', 'Gemini session', 'Resume a session…Ctrl+Shift+R', 'Ask two agents…Ctrl+Shift+A'])
    await expect(page.getByRole('menuitem', { name: /Claude session/ })).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: /Codex session/ })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(chevron).toHaveAttribute('aria-expanded', 'false')

    await chevron.click()
    await page.getByRole('menuitem', { name: /Gemini session/ }).click()
    await expect(page.locator('.quickpick')).toBeVisible()
    await expect(page.locator('.quickpick .option').first()).toContainText('Gemini')
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['gemini'])

    await page.getByRole('button', { name: 'New session, Ctrl+N' }).click()
    await expect(page.locator('.quickpick .option').first()).toContainText('Claude')
  } finally {
    await closeApp(app)
  }
})

test('compact header keeps New session, zoom, Settings and Theme usable at 960px', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.setViewportSize({ width: 960, height: 600 })
    const newSession = page.getByRole('button', { name: 'New session, Ctrl+N' })
    await expect(newSession).toContainText('New session')
    for (const name of ['Decrease font size', 'Increase font size', 'Settings', 'Theme']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
    expect(await page.locator('.topbar').evaluate((bar) => bar.scrollWidth <= bar.clientWidth)).toBe(true)
    await page.getByRole('button', { name: 'Theme', exact: true }).click()
    await expect(page.locator('.theme-picker')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.locator('.settings-view')).toBeVisible()
    await newSession.click()
    await expect(page.locator('.quickpick')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('the top bar never pushes out its icons, with the usage limits shown and a sub-agent running', async () => {
  const sandbox = createSandbox()
  const now = Date.now()
  const slug = sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-')
  const dir = join(sandbox.claudeHome, 'projects', slug)
  const subagents = join(dir, SESSION_ID, 'subagents')
  mkdirSync(subagents, { recursive: true })
  const iso = (minutes: number): string => new Date(now - minutes * 60_000).toISOString()
  writeFileSync(join(dir, `${SESSION_ID}.jsonl`), JSON.stringify({ type: 'user', timestamp: iso(30), cwd: sandbox.projectFolder, message: { content: 'Polish the release' } }) + '\n')
  writeFileSync(join(subagents, 'agent-run1.meta.json'), JSON.stringify({ agentType: 'general-purpose', spawnDepth: 1, requestShape: 'background', model: 'sonnet', description: 'Unit tests' }))
  const usage = { input_tokens: 100, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  writeFileSync(join(subagents, 'agent-run1.jsonl'), [
    { type: 'user', timestamp: iso(10), cwd: sandbox.projectFolder, isSidechain: true, message: { role: 'user', content: 'Go' } },
    { type: 'assistant', timestamp: new Date(now - 1000).toISOString(), message: { id: 'm1', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }
  ].map((record) => JSON.stringify(record)).join('\n'))
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: /^New (Claude|Codex|Gemini) session in Smoke$/ }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    writeFileSync(join(sandbox.sessionsDir, 'smoke.json'), JSON.stringify({ pid: process.pid, sessionId: SESSION_ID, cwd: sandbox.projectFolder, name: 'Polish the release', nameSource: 'user', status: 'busy', startedAt: now + 1000, updatedAt: now + 1000 }), 'utf8')
    mkdirSync(sandbox.opsDir, { recursive: true })
    writeFileSync(join(sandbox.opsDir, `${SESSION_ID}.json`), JSON.stringify({
      v: 1, sessionId: SESSION_ID, cwd: sandbox.projectFolder, updatedAt: now, ended: false, model: 'claude-opus-5-5', agents: [],
      limits: [
        { kind: 'five_hour', percentUsed: 62, resetsAt: new Date(now + 100 * 60_000).toISOString() },
        { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(now + 4 * 86_400_000).toISOString() }
      ]
    }), 'utf8')
    await expect(page.locator('.topbar-limits')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('#background-button .bg-badge')).toBeVisible({ timeout: 20_000 })
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
