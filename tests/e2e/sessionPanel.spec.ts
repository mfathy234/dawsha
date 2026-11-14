import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, closePaneViaActions, createSandbox, launchApp, QUIT_BUDGET_MS, type Sandbox } from './helpers'

const SESSION_ID = '33333333-4444-4555-8666-777777777777'
const DESKTOP = { panes: 'quiet', frame: 'sidebar', tone: 'warm' }

const stamp = (minute: number): string => new Date(Date.UTC(2026, 9, 8, 9, minute, 0)).toISOString()
const settingsOf = (sandbox: Sandbox): Record<string, any> => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))

function seedSettings(sandbox: Sandbox, patch: Record<string, unknown>): void {
  const file = join(sandbox.userData, 'settings.json')
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...patch }), 'utf8')
}

function seedSession(sandbox: Sandbox): void {
  const dir = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const plan = join(sandbox.projectFolder, 'plan.md')
  const code = join(sandbox.projectFolder, 'src', 'a.ts')
  mkdirSync(join(sandbox.projectFolder, 'src'), { recursive: true })
  writeFileSync(plan, '# The plan\n\nShip it.\n', 'utf8')
  writeFileSync(code, 'export const a = 2\n', 'utf8')
  const records = [
    { type: 'user', timestamp: stamp(0), message: { content: 'Write the plan' } },
    { type: 'assistant', timestamp: stamp(2), message: { content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: code, old_string: 'a = 1', new_string: 'a = 2' } }] } },
    { type: 'user', timestamp: stamp(3), message: { content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'ok' }] } },
    { type: 'assistant', timestamp: stamp(5), message: { content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: plan, content: '# The plan\n\nShip it.\n' } }] } },
    { type: 'user', timestamp: stamp(6), message: { content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'ok' }] } },
    { type: 'ai-title', aiTitle: 'Write the plan' }
  ]
  writeFileSync(join(dir, `${SESSION_ID}.jsonl`), records.map((record) => JSON.stringify(record)).join('\n') + '\n')
}

async function resumeSeeded(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+R')
  await expect(page.locator('.rp-row')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
}

test('the collapsed rail has its expand button at the foot, above Add project', async () => {
  const sandbox = createSandbox()
  seedSettings(sandbox, { appearance: DESKTOP, sidebarCollapsed: true })
  const { app, page } = await launchApp(sandbox)
  try {
    const sidebar = page.locator('.sidebar')
    await expect(sidebar).toHaveClass(/rail/)
    const expand = sidebar.locator('#sidebar-expand')
    await expect(expand).toBeVisible()
    await expect(sidebar.locator('#sidebar-collapse')).toBeHidden()
    const add = sidebar.getByRole('button', { name: 'Add project' })
    const settings = sidebar.locator('#settings-button')
    const [e, a, s, bell] = await Promise.all([expand.boundingBox(), add.boundingBox(), settings.boundingBox(), sidebar.locator('#notifications-button').boundingBox()])
    expect(e!.y).toBeGreaterThan(bell!.y + 100)
    expect(e!.y + e!.height).toBeLessThanOrEqual(a!.y + 1)
    expect(a!.y).toBeLessThan(s!.y)
    await expand.click()
    await expect(sidebar).not.toHaveClass(/rail/)
    await expect(sidebar.locator('#sidebar-collapse')).toBeVisible()
    await expect(sidebar.locator('#sidebar-expand')).toBeHidden()
    await sidebar.locator('#sidebar-collapse').click()
    await expect(sidebar).toHaveClass(/rail/)
  } finally {
    await closeApp(app)
  }
})

test('the notification count is a small badge on the bell in the rail and in the expanded sidebar', async () => {
  const sandbox = createSandbox()
  seedSession(sandbox)
  seedSettings(sandbox, { appearance: DESKTOP })
  const { app, page } = await launchApp(sandbox)
  try {
    await resumeSeeded(page)
    await closePaneViaActions(page.locator('.pane').first())
    const bell = page.locator('.sidebar #notifications-button')
    const badge = bell.locator('.bell-badge')
    await expect(badge).toHaveText('1', { timeout: 15_000 })
    const onBell = async (): Promise<void> => {
      const [b, d] = await Promise.all([bell.boundingBox(), badge.boundingBox()])
      expect(d!.x).toBeGreaterThan(b!.x + b!.width / 2 - 2)
      expect(d!.y).toBeLessThan(b!.y + b!.height / 2)
      expect(d!.width).toBeLessThanOrEqual(20)
      expect(b!.height).toBeLessThanOrEqual(32)
    }
    await onBell()
    await page.locator('#sidebar-collapse').click()
    await expect(page.locator('.sidebar')).toHaveClass(/rail/)
    await expect(badge).toHaveText('1')
    await onBell()
  } finally {
    await closeApp(app)
  }
})

test('the Session tab lists the files the session wrote and opens one in Files', async () => {
  const sandbox = createSandbox()
  seedSession(sandbox)
  seedSettings(sandbox, { appearance: DESKTOP })
  const first = await launchApp(sandbox)
  try {
    const { page } = first
    await resumeSeeded(page)
    const toggle = page.locator('#session-panel-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.side-panel')).toBeHidden()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const panel = page.locator('.side-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('tab', { name: /^Session/ })).toHaveAttribute('aria-selected', 'true')
    await expect(panel.getByRole('button', { name: 'Back to grid' })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Compact' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Clear' })).toBeVisible()

    const rows = panel.locator('.session-output')
    await expect(rows).toHaveCount(2, { timeout: 35_000 })
    await expect(rows.nth(0)).toContainText('plan.md')
    await expect(rows.nth(0)).toContainText('new')
    await expect(rows.nth(1)).toContainText('a.ts')
    await expect(rows.nth(1)).toContainText('src')
    await expect(rows.nth(1)).toContainText('edited')

    await panel.getByRole('button', { name: 'Actions for plan.md' }).click()
    await expect(page.getByRole('menuitem', { name: 'Open in Files' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Reveal in File Explorer' })).toBeVisible()
    await page.keyboard.press('Escape')

    await rows.nth(0).click()
    await expect(page.locator('.files-view')).toBeVisible()
    await expect(page.locator('.files-view').getByText('plan.md').first()).toBeVisible({ timeout: 20_000 })

    await expect.poll(() => settingsOf(sandbox).sidePanel?.docked).toBe(true)
  } finally {
    expect(await closeApp(first.app)).toBeLessThan(QUIT_BUDGET_MS)
  }

  const second = await launchApp(sandbox)
  try {
    const { page } = second
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    const toggle = page.locator('#session-panel-toggle')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.side-panel')).toBeVisible()
    await page.keyboard.press('Control+Alt+b')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.side-panel')).toBeHidden()
    await expect.poll(() => settingsOf(sandbox).sidePanel?.docked).toBe(false)
  } finally {
    await closeApp(second.app)
  }
})

test('Classic has no panel toggle and keeps the Side panel layout as it was', async () => {
  const sandbox = createSandbox()
  seedSession(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await resumeSeeded(page)
    await expect(page.locator('#session-panel-toggle')).toHaveCount(0)
    await expect(page.locator('.side-panel')).toBeHidden()
    await page.locator('#layout-panel').click()
    const panel = page.locator('.side-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('tab')).toHaveText([/^Session/, /^Changes/, /^Plan/, /^Checks/])
    await expect(panel.locator('.session-output')).toHaveCount(2, { timeout: 35_000 })
  } finally {
    await closeApp(app)
  }
})
