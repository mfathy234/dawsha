import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp } from './helpers'

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd })

test('History exports a finished bug run and imports it as a read-only run', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  git(sandbox.projectFolder, 'init', '-q', '-b', 'main')
  writeFileSync(join(sandbox.projectFolder, 'README.md'), 'hello\n')
  git(sandbox.projectFolder, 'add', '.'); git(sandbox.projectFolder, 'commit', '-qm', 'first')
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ version: 2, lastSeenVersion: APP_VERSION,
    onboardingDismissed: true, experimental: { orchestrator: true }, projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }] }))
  const path = join(sandbox.root, 'history.dawsharun')
  const { app, page } = await launchApp(sandbox, { DAWSHA_CLAUDE_COMMAND: process.execPath,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([resolve(__dirname, '../support/fakeOrchAgent.cjs')]),
    DAWSHA_SAVE_PATH: path, DAWSHA_OPEN_PATHS: JSON.stringify([path]) })
  try {
    await page.locator('#orchestrator-button').click()
    await page.locator('#orch-tab-history').click({ timeout: 5000 })
    await expect(page.locator('.orch-history')).toContainText('No history yet')
    await page.locator('#orch-tab-new').click()
    await page.locator('#orch-nr-kind').getByText('Bug', { exact: true }).click()
    await page.locator('#orch-nr-story').fill('The export button crashes on an empty range.')
    await page.locator('#orch-nr-title').fill('History export crash')
    await page.locator('#orch-nr-start').click()
    await expect(page.locator('#orchestrator-button .orch-badge')).toHaveText('1', { timeout: 60_000 })
    await page.locator('#orch-tab-review').click()
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.locator('#orch-tab-history').click()
    const rows = page.locator('.orch-history tbody tr')
    await expect(rows).toHaveCount(1, { timeout: 15000 })
    await expect(rows.first()).toContainText('History export crash')
    await rows.first().getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Export selected (1)', exact: true }).click()
    await expect.poll(() => existsSync(path)).toBe(true)
    const archive = JSON.parse(gunzipSync(readFileSync(path)).toString())
    expect(archive.run.stage).toBe('done')
    expect(archive.agents[0]).not.toHaveProperty('token')
    await page.getByRole('button', { name: 'Import runs…', exact: true }).click()
    await expect(rows).toHaveCount(2)
    const imported = rows.filter({ hasText: 'imported' })
    await expect(imported).toHaveCount(1)
    await page.getByLabel('Result', { exact: true }).selectOption('imported')
    await expect(rows).toHaveCount(1)
    await page.getByLabel('Search history', { exact: true }).fill('no match')
    await expect(rows).toHaveCount(0)
    await page.getByLabel('Search history', { exact: true }).fill('empty range')
    await expect(rows).toHaveCount(1)
    await page.getByLabel('Search history', { exact: true }).fill('is finished on branch')
    await expect(rows).toHaveCount(1)
    await page.getByLabel('Search history', { exact: true }).fill('')
    await rows.first().getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page.locator('.orch-run')).toContainText('Imported from history.dawsharun')
    await expect(page.locator('.orch-run').getByRole('button', { name: 'Cancel run' })).toHaveCount(0)
    await expect(page.locator('.orch-run').getByRole('button', { name: 'Continue with…' })).toHaveCount(0)
    await page.locator('#orch-tab-history').click()
    await page.getByLabel('Result', { exact: true }).selectOption('')
    const md = join(sandbox.root, 'history.md')
    await app.evaluate((_electron, value) => { process.env.DAWSHA_SAVE_PATH = value }, md)
    await rows.first().getByRole('button', { name: 'Export as Markdown', exact: true }).click()
    await expect.poll(() => existsSync(md)).toBe(true)
    expect(readFileSync(md, 'utf8')).toContain('Guarded the empty range')
    mkdirSync('test-results/screens', { recursive: true })
    await page.screenshot({ path: 'test-results/screens/orch-history.png' })
    // Narrow light-theme rendering preserves access to filters and the scrollable table.
    await page.setViewportSize({ width: 700, height: 800 })
    await page.evaluate(() => document.documentElement.setAttribute('data-kind', 'light'))
    await expect(page.getByLabel('Search history', { exact: true })).toBeVisible()
  } finally { await closeApp(app) }
})
