import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp, openSettings, type Sandbox } from './helpers'

const fixture = readFileSync(join(__dirname, '../unit/fixtures/statusline-payload.json'), 'utf8')

function seed(sandbox: Sandbox, extra: Record<string, unknown>): void {
  const settings = { version: 2, lastSeenVersion: APP_VERSION, projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }], ...extra }
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify(settings), 'utf8')
}

function limitFiles(sandbox: Sandbox): void {
  const sessionId = 'sess-limits-1'
  const now = Date.now()
  writeFileSync(join(sandbox.sessionsDir, `${sessionId}.json`), JSON.stringify({ pid: process.pid, sessionId, cwd: sandbox.projectFolder, name: 'Limits', nameSource: 'user', status: 'idle', startedAt: now + 1000, updatedAt: now + 1000 }), 'utf8')
  const dir = join(sandbox.userData, 'status')
  mkdirSync(dir, { recursive: true })
  const payload = {
    ...JSON.parse(fixture),
    session_id: sessionId,
    rate_limits: {
      five_hour: { used_percentage: 38, resets_at: Math.floor((now + 5 * 3_600_000) / 1000) },
      seven_day: { used_percentage: 74, resets_at: Math.floor((now + 4 * 86_400_000) / 1000) }
    }
  }
  writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify(payload), 'utf8')
}

const DESKTOP = { panes: 'quiet', frame: 'sidebar', tone: 'warm' }

test('Settings has a way back: the link, Escape and the Sessions row', async () => {
  const sandbox = createSandbox()
  seed(sandbox, { appearance: DESKTOP })
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'appearance')
    await page.locator('#settings-back').click()
    await expect(page.locator('.settings-view')).toBeHidden()

    await page.locator('#settings-button').click()
    await expect(page.locator('.settings-view')).toBeVisible()
    await page.locator('.settings-tab.selected').focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('.settings-view')).toBeHidden()

    await page.locator('#settings-button').click()
    await expect(page.locator('.settings-view')).toBeVisible()
    await page.locator('#sessions-button').click()
    await expect(page.locator('.settings-view')).toBeHidden()

    await page.locator('#files-button').click()
    await page.locator('#settings-button').click()
    await page.locator('.settings-tab.selected').focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('#files-button')).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await closeApp(app)
  }
})

test('Find in Settings filters the sections and rows, marks the match and Escape clears it', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'general')
    const search = page.locator('#settings-search')
    await search.fill('sound')
    await expect(page.locator('.settings-tab')).toHaveCount(1)
    await expect(page.locator('#settings-tab-notifications')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#sound-toggle')).toBeVisible()
    await expect(page.locator('#bridge-toggle')).toBeHidden()
    await expect(page.locator('.settings-panel .set-match')).toHaveCount(1)

    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(page.locator('.settings-tab')).not.toHaveCount(1)
    await expect(page.locator('#bridge-toggle')).toBeVisible()
    await expect(page.locator('.settings-view')).toBeVisible()

    await search.fill('zzzz')
    await expect(page.locator('.settings-no-match')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('Desktop app style shows On with Back to Classic when it is already on', async () => {
  const sandbox = createSandbox()
  seed(sandbox, { appearance: DESKTOP })
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'appearance')
    await expect(page.locator('#appearance-desktop-on')).toHaveText('On')
    await expect(page.locator('#appearance-use-desktop')).toHaveCount(0)
    await expect(page.locator('#appearance-back-classic')).toBeEnabled()
  } finally {
    await closeApp(app)
  }
})

test('the Sidebar frame shows the limit rings above the panes, not in the sidebar footer', async () => {
  const sandbox = createSandbox()
  seed(sandbox, { appearance: DESKTOP })
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    // The row above the panes holds the layout switch; no rings until limits are reported.
    await expect(page.locator('.frame-bar #layout-grid')).toBeVisible()
    await expect(page.locator('.frame-bar .limit-ring')).toHaveCount(0)
    await page.getByRole('button', { name: /^New (Claude|Codex|Gemini) session in Smoke$/ }).first().click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    limitFiles(sandbox)
    await openSettings(page, 'notifications')
    await page.locator('#bridge-toggle').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Edit ~/.claude/settings.json' }).click()
    await expect(page.locator('#bridge-toggle')).toBeChecked()
    await page.locator('#settings-back').click()
    const five = page.locator('.frame-bar #topbar-limits [data-limit="five_hour"]')
    await expect(five).toHaveAttribute('title', /38%/, { timeout: 15_000 })
    await expect(page.locator('.frame-bar .limit-ring')).toHaveCount(2)
    await expect(page.locator('.frame-foot .topbar-limits')).toHaveCount(0)
    const bar = (await page.locator('.frame-bar').boundingBox())!
    const pane = (await page.locator('.pane').first().boundingBox())!
    expect(bar.y + bar.height).toBeLessThanOrEqual(pane.y + 1)
    await expect(page.locator('.frame-bar .topbar-limits')).not.toContainText('no limits reported')
    await page.setViewportSize({ width: 1024, height: 728 })
    expect(await page.locator('.frame-bar').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  } finally {
    await closeApp(app)
  }
})
