import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp } from './helpers'

const FAKE_ORCH = resolve(__dirname, '../support/fakeOrchAgent.cjs')
const SCREENS = 'test-results/screens'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: join(SCREENS, `orch-${name}.png`) })

test('Settings → Orchestrator edits plans and profiles, and the view works in a light theme', async () => {
  test.setTimeout(60_000)
  mkdirSync(SCREENS, { recursive: true })
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    version: 2,
    lastSeenVersion: APP_VERSION,
    onboardingDismissed: true,
    theme: { id: 'dawsha-daylight' },
    experimental: { orchestrator: true },
    projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }]
  }))
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#orchestrator-button').click()
    await page.locator('#orch-tab-new').click()
    await expect(page.locator('#orch-nr-plans')).toContainText('Budget')
    await shot(page, 'light-new-run-feature')
    await page.locator('#orch-nr-open-plans').click()
    await expect(page.locator('.settings-view')).toContainText('Lead')
    await expect(page.locator('.settings-view')).toContainText('Prices')
    await shot(page, 'light-settings')
  } finally {
    await closeApp(app)
  }
})

test('fix a bug from the Orchestrator view and finish it in Human review', async () => {
  test.setTimeout(120_000)
  mkdirSync(SCREENS, { recursive: true })
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    version: 2,
    lastSeenVersion: APP_VERSION,
    onboardingDismissed: true,
    experimental: { orchestrator: true },
    projects: [{ id: 'smoke', name: 'Smoke', folder: repo }]
  }))
  const { app, page } = await launchApp(sandbox, {
    DAWSHA_CLAUDE_COMMAND: process.execPath,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([FAKE_ORCH])
  })
  try {
    // The top bar has an Orchestrator button; the view starts empty.
    await page.locator('#orchestrator-button').click()
    await expect(page.locator('.orch-view')).toBeVisible()
    await expect(page.locator('.orch-view')).toContainText('Start a run')
    await shot(page, 'empty')

    // New run: a bug, fixed by the plan's main model.
    await page.locator('#orch-tab-new').click()
    await page.locator('#orch-nr-kind').getByText('Bug', { exact: true }).click()
    await page.locator('#orch-nr-story').fill('The export button crashes when the range is empty.')
    await page.locator('#orch-nr-title').fill('Export crashes on an empty range')
    await shot(page, 'new-run-bug')
    await page.locator('#orch-nr-start').click()

    // The fixer opens as a pane; the run finishes building and asks the human to mark it done.
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    // Starting a run already shows its dashboard; the top bar button toggles the view, so only open it if hidden.
    if (!(await page.locator('.orch-view').isVisible())) await page.locator('#orchestrator-button').click()
    await expect(page.locator('.orch-view')).toBeVisible()
    await expect(page.locator('.orch-view')).toContainText('Export crashes on an empty range')
    await expect(page.locator('#orchestrator-button .orch-badge')).toHaveText('1', { timeout: 60_000 })
    await shot(page, 'run-dashboard')

    await page.locator('#orch-tab-runs').click()
    await expect(page.locator('.orch-view')).toContainText('Run finished')
    await shot(page, 'all-runs')

    await page.locator('#orch-tab-boards').click()
    await expect(page.locator('.orch-view')).toContainText('T-1')
    await shot(page, 'boards')

    await page.locator('#orch-tab-review').click()
    await expect(page.locator('.orch-view')).toContainText('is finished on branch orch/')
    await shot(page, 'review')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('#orchestrator-button .orch-badge')).toBeHidden({ timeout: 15_000 })
    await expect(page.locator('.orch-view')).toContainText('Nothing needs you right now')
  } finally {
    await closeApp(app)
  }
})
