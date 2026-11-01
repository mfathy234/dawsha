import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const SCREENS = 'test-results/screens'
const SLOW = 20_000

const dismiss = (page: Page, scope: string) => page.locator(scope).getByRole('button', { name: 'Dismiss', exact: true })

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SCREENS, `popup-${name}.png`) })
}

async function openPaletteCommand(page: Page, query: string, commandId: string): Promise<void> {
  await expect(page.locator('.overlay')).toHaveCount(0)
  await page.keyboard.press('Control+k')
  const input = page.getByPlaceholder('Type a command, a session or a project')
  await expect(input).toBeVisible()
  await input.fill(query)
  await page.locator(`.palette-row[data-command="${commandId}"]`).click()
}

test('palettes, pickers and popovers each close with their Dismiss button', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await expect(page.locator('#palette-input')).toBeFocused()
    await expect(dismiss(page, '.palette')).toBeVisible()
    await shot(page, 'palette')
    // Arrow keys still move through the rows and Tab never lands on the X.
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('#palette-input')).toBeFocused()
    await dismiss(page, '.palette').click()
    await expect(palette).toHaveCount(0)

    await openPaletteCommand(page, 'replay', 'replay.open')
    const replay = page.getByRole('dialog', { name: 'Replay a session' })
    await expect(replay).toBeVisible()
    await expect(page.locator('#replay-picker-input')).toBeFocused()
    await shot(page, 'replay-picker')
    await dismiss(page, '.replay-picker').click()
    await expect(replay).toHaveCount(0)

    await page.keyboard.press('Control+n')
    const quick = page.getByRole('dialog', { name: 'New session' })
    await expect(quick).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Filter projects' })).toBeFocused()
    await shot(page, 'quickpick')
    await dismiss(page, '.new-dialog').click()
    await expect(quick).toHaveCount(0)

    await page.keyboard.press('Control+Shift+R')
    const resume = page.locator('.resume-picker')
    await expect(resume).toBeVisible()
    await expect(page.locator('#rp-search')).toBeFocused()
    await shot(page, 'resume-picker')
    await dismiss(page, '.resume-picker').click()
    await expect(resume).toHaveCount(0)

    await page.locator('#view-button').click()

    await page.locator('#layouts-button').click()
    const layouts = page.getByRole('dialog', { name: 'Saved layouts' })
    await expect(layouts).toBeVisible()
    await shot(page, 'layouts')
    await dismiss(page, '.layouts-popover').click()
    await expect(layouts).toHaveCount(0)

    await page.locator('#settings-button').click()
    await page.locator('#settings-tab-appearance').click()
    await page.locator('#settings-theme-picker').click()
    const theme = page.getByRole('dialog', { name: 'Theme' })
    await expect(theme).toBeVisible()
    await shot(page, 'theme')
    await dismiss(page, '.theme-picker').click()
    await expect(theme).toHaveCount(0)
    await page.locator('#settings-button').click()
  } finally {
    await closeApp(app)
  }
})

test('the branch picker closes with its Dismiss button', async () => {
  const sandbox = createSandbox()
  const identity = ['-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid']
  const git = (...args: string[]): string => execFileSync('git', [...identity, ...args], { cwd: sandbox.projectFolder, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(sandbox.projectFolder, 'a.txt'), 'one\n')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: /^New (Claude|Codex|Gemini) session in Smoke$/ }).click()
    await expect(page.locator('.chip-branch')).toBeVisible({ timeout: SLOW })
    await page.locator('.term-host.active').click()
    await page.keyboard.press('Control+k')
    await page.locator('#palette-input').fill('Switch branch')
    await page.locator('.palette-row[data-command="git.switch"]').click()
    const picker = page.getByRole('dialog', { name: 'Switch branch' })
    await expect(picker).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Switch branch' })).toBeFocused()
    await shot(page, 'branch-picker')
    await dismiss(page, '.branch-picker').click()
    await expect(picker).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('the update popover closes with its Dismiss button', async () => {
  const sandbox = createSandbox()
  const script = { check: 'available', info: { version: '9.9.0', releaseDate: '2026-11-01T10:00:00.000Z', releaseNotes: 'Fixes' }, hold: true }
  const { app, page } = await launchApp(sandbox, {
    DAWSHA_TEST_UPDATER: 'fake',
    DAWSHA_TEST_UPDATER_SCRIPT: JSON.stringify(script),
    DAWSHA_TEST_UPDATER_LOG: join(sandbox.root, 'updater.log'),
    DAWSHA_UPDATE_START_DELAY_MS: '200',
    DAWSHA_UPDATE_INTERVAL_MS: '3600000'
  })
  try {
    await page.locator('#update-pill').click()
    const popover = page.getByRole('dialog', { name: 'Update' })
    await expect(popover).toBeVisible()
    await shot(page, 'update')
    await dismiss(page, '.update-popover').click()
    await expect(popover).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
