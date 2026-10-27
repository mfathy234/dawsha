import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp, openMore } from './helpers'

const FAKE_ORCH = resolve(__dirname, '../support/fakeOrchAgent.cjs')

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

// A user's real run got stuck here: the lead asked while planning (no task of its own), the user replied in
// Human review, and the answer never reached the lead.
test('the lead asks while planning, the human replies in Human review, and the run moves on', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true,
    experimental: { orchestrator: true },
    projects: [{ id: 'smoke', name: 'Smoke', folder: repo }]
  }))
  const { app, page } = await launchApp(sandbox, { DAWSHA_CLAUDE_COMMAND: process.execPath, DAWSHA_CLAUDE_ARGS: JSON.stringify([FAKE_ORCH]) })
  try {
    await openMore(page, 'orchestrator')
    await page.locator('#orch-tab-new').click()
    await page.locator('#orch-nr-story').fill('ASK: Which config key should provisioning use?')
    // The lead decides whether a spec is needed, so the button does not promise one.
    await expect(page.locator('#orch-nr-start')).toHaveText('Start run')
    await expect(page.locator('.orch-nr-footer')).toContainText('If the lead writes a spec, nothing is built until you approve it.')
    await page.locator('#orch-nr-start').click()
    // The question shows up for the human.
    await expect(page.locator('#more-button .orch-badge')).toHaveText('1', { timeout: 30_000 })
    if (!(await page.locator('.orch-view').isVisible())) await openMore(page, 'orchestrator')
    await page.locator('#orch-tab-review').click()
    await expect(page.locator('.orch-view')).toContainText('Which config key should provisioning use?')
    await page.getByLabel('Your answer').fill('A new key, defaulting to main')
    await page.getByRole('button', { name: 'Send' }).click()
    // The lead gets the answer and plans; the implementer then starts.
    await expect.poll(async () => {
      const snapshot = await page.evaluate(() => window.gridApi.orchSnapshot())
      return snapshot.runs[0]?.tasks.map((t) => `${t.role}:${t.title}`)
    }, { timeout: 30_000 }).toEqual(expect.arrayContaining(['implementer:Do it: A new key, defaulting to main']))
    // The implementer does it and, with nothing left to do, its pane closes; the lead's stays.
    await expect.poll(async () => {
      const snapshot = await page.evaluate(() => window.gridApi.orchSnapshot())
      return snapshot.runs[0]?.tasks.find((t) => t.role === 'implementer')?.status
    }, { timeout: 30_000 }).toBe('approved')
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 15_000 })
  } finally {
    await closeApp(app)
  }
})
