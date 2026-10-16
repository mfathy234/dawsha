import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { OrchRunDetail } from '../../src/shared/orch/api'
import { APP_VERSION, closeApp, createSandbox, launchApp } from './helpers'

const FAKE_ORCH = resolve(__dirname, '../support/fakeOrchAgent.cjs')
const SCREENS = 'test-results/screens'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: join(SCREENS, `orch-${name}.png`) })

for (const theme of ['dawsha-night', 'dawsha-daylight']) {
  test(`run stages show accessible progress and wrap without controls in ${theme}`, async () => {
    const sandbox = createSandbox()
    writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
      version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true,
      theme: { id: theme }, experimental: { orchestrator: true }
    }))
    const { app, page } = await launchApp(sandbox)
    // Supply run states at the IPC boundary; render the real dashboard and theme CSS.
    const publish = async (kind: OrchRunDetail['kind'], stage: OrchRunDetail['stage']): Promise<void> => {
      const run: OrchRunDetail = {
        id: 'stage-track', kind, stage, title: 'Progress track', projectId: null,
        createdAt: 1, taskCount: 0, tasksDone: 0, openDecisions: 0,
        story: '', plan: 'Budget', projectPath: '', finishedAt: null, branch: '',
        tasks: [], agents: [], events: [],
        usage: { agents: [], byRole: [], total: { inputTokens: 0, outputTokens: 0,
          cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: 0, complete: true } }
      }
      await app.evaluate(({ ipcMain, webContents }, value) => {
        ipcMain.removeHandler('orch:snapshot')
        ipcMain.handle('orch:snapshot', () => ({
          status: { enabled: true, running: true, error: null }, runs: [value], decisions: []
        }))
        for (const contents of webContents.getAllWebContents()) contents.send('orch:changed')
      }, run)
    }
    try {
      await publish('bug', 'build')
      await page.locator('#orchestrator-button').click()
      await page.getByRole('button', { name: 'Open', exact: true }).click()
      const track = page.getByRole('list', { name: 'Stages', exact: true })
      const items = track.locator('li:not(.cancelled)')
      for (const kind of ['bug', 'feature'] as const) {
        const labels = kind === 'bug' ? ['Build', 'Merge', 'Done'] : ['Spec', 'Plan', 'Build', 'Merge', 'Done']
        const stages = kind === 'bug' ? ['build', 'review', 'merge', 'done', 'cancelled'] as const
          : ['spec', 'plan', 'build', 'review', 'merge', 'done', 'cancelled'] as const
        for (const stage of stages) {
          await publish(kind, stage)
          const at = labels.indexOf(stage === 'review' ? 'Build' : stage[0].toUpperCase() + stage.slice(1))
          const states = labels.map((_, i) => stage === 'done' ? 'done' : i < at ? 'done' : i === at ? 'current' : 'upcoming')
          await expect(items).toHaveText(labels.map((label, i) => `${label} (${states[i]})`))
          await expect(track.locator('[aria-current="step"]')).toHaveCount(stage === 'done' || stage === 'cancelled' ? 0 : 1)
          await expect(track.locator('button, a, [tabindex]')).toHaveCount(0)
        }
        await publish(kind, 'merge')
        await expect(track.locator('[aria-current="step"]')).toContainText('Merge')
        await page.setViewportSize({ width: 1440, height: 900 })
        mkdirSync(SCREENS, { recursive: true })
        await shot(page, `stage-track-${kind}-${theme}`)
      }
    } finally { await closeApp(app) }
  })
}

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
    // The completed fixer is in Done; the default Open filter hides it.
    await page.locator('.orch-filter').filter({ hasText: /^Status/ }).locator('select').selectOption('all')
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
