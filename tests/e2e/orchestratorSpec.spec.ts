import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp } from './helpers'

for (const theme of ['dawsha-night', 'dawsha-daylight']) {
  test(`spec review supports feedback, versions and approval in ${theme}`, async () => {
    test.setTimeout(120_000)
    const sandbox = createSandbox()
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: sandbox.projectFolder })
    }
    git('init', '-q', '-b', 'main')
    writeFileSync(join(sandbox.projectFolder, 'README.md'), 'Test')
    git('add', '.')
    git('commit', '-qm', 'initial')
    writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
      version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true, theme: { id: theme },
      experimental: { orchestrator: true }, projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }]
    }))
    const { app, page } = await launchApp(sandbox, {
      DAWSHA_CLAUDE_COMMAND: process.execPath,
      DAWSHA_CLAUDE_ARGS: JSON.stringify([resolve(__dirname, '../support/fakeOrchAgent.cjs')])
    })
    try {
      await page.setViewportSize({ width: 1440, height: 1200 })
      await page.locator('#orchestrator-button').click()
      await page.locator('#orch-tab-new').click()
      await page.locator('#orch-nr-story').fill('Export usage as CSV')
      await page.locator('#orch-nr-title').fill('CSV spec')
      await page.locator('#orch-nr-start').click()
      await page.getByRole('button', { name: 'Review spec', exact: true }).click({ timeout: 30_000 })
      const screen = page.locator('.orch-spec')
      await expect(screen.getByRole('heading', { name: 'Goal v1', exact: true })).toBeVisible()
      const preview = screen.locator('iframe')
      await expect(preview).toHaveAttribute('sandbox', '')
      await expect(page.frameLocator('.orch-spec iframe').getByRole('heading', { name: 'Export dialog v1' })).toBeVisible()
      expect(await page.frameLocator('.orch-spec iframe').locator('body').getAttribute('data-script-ran')).toBeNull()
      await screen.getByRole('button', { name: 'Phone', exact: true }).click()
      await expect(preview).toHaveCSS('width', '390px')
      await screen.getByRole('button', { name: 'Request changes', exact: true }).click()
      await expect(screen).toBeVisible()
      await screen.getByLabel('Comment target').selectOption('export-dialog.html')
      await screen.getByLabel('Comment text').fill('Show empty range')
      await screen.getByRole('button', { name: 'Add comment', exact: true }).click()
      await expect(screen).toContainText('Show empty range')
      await screen.getByRole('button', { name: 'Desktop', exact: true }).click()
      await expect(page.frameLocator('.orch-spec iframe').getByRole('heading', { name: 'Export dialog v1' })).toBeVisible()
      while (await page.locator('.toast').count()) await page.locator('.toast').first().click()
      mkdirSync('test-results/screens', { recursive: true })
      await page.screenshot({ path: `test-results/screens/orch-spec-review${theme === 'dawsha-daylight' ? '-light' : ''}.png`, animations: 'disabled' })
      await screen.getByRole('button', { name: 'Request changes', exact: true }).click()
      await expect(page.locator('.orch-run')).toBeVisible()
      await expect.poll(async () => {
        const snapshot = await page.evaluate(() => window.gridApi.orchSnapshot())
        return snapshot.runs[0].events.some((e) => e.text.includes('You answered: - [mockup export-dialog.html] Show empty range'))
      }).toBe(true)
      await page.locator('#orch-tab-review').click()
      await page.getByRole('button', { name: 'Review spec & mockups', exact: true }).click({ timeout: 20_000 })
      await expect(screen.getByRole('heading', { name: 'Goal v2', exact: true })).toBeVisible()
      await screen.getByLabel('Spec version').selectOption('1')
      await expect(screen.getByRole('heading', { name: 'Goal v1', exact: true })).toBeVisible()
      await expect(screen).toContainText('Show empty range')
      await expect(screen.getByRole('button', { name: 'Approve spec & mockups', exact: true })).toBeDisabled()
      await screen.getByLabel('Spec version').selectOption('2')
      // Preserve an unfinished draft while the writer replaces the mockup in a new version.
      await screen.getByLabel('Comment target').selectOption('export-dialog.html')
      await screen.getByLabel('Comment text').fill('Keep keyboard access')
      await page.evaluate(async () => {
        const decisions = await window.gridApi.orchDecisions()
        const spec = decisions.find((d) => d.kind === 'spec-approval')!
        await window.gridApi.orchAnswer(spec.id, 'Revise mockup names')
      })
      await expect(screen.getByRole('heading', { name: 'Goal v3', exact: true })).toBeVisible()
      await expect(screen.getByLabel('Comment target')).toHaveValue('spec')
      await screen.getByRole('button', { name: 'Request changes', exact: true }).click()
      await expect.poll(async () => {
        const snapshot = await page.evaluate(() => window.gridApi.orchSnapshot())
        return snapshot.runs[0].events.some((e) => e.text === 'You answered: - [spec] Keep keyboard access')
      }).toBe(true)
      await page.getByRole('button', { name: 'Review spec', exact: true }).click()
      await expect(screen.getByRole('heading', { name: 'Goal v4', exact: true })).toBeVisible()
      await screen.getByRole('button', { name: 'Approve spec & mockups', exact: true }).click()
      await expect(page.locator('.orch-run')).toBeVisible()
      await page.getByRole('button', { name: 'Spec', exact: true }).click()
      await expect(screen.getByRole('heading', { name: 'Goal v4', exact: true })).toBeVisible()
      await expect(screen.getByRole('button', { name: 'Approve spec & mockups', exact: true })).toHaveCount(0)
      await page.setViewportSize({ width: 650, height: 850 })
      await expect(preview).toBeVisible()
      expect(await screen.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    } finally { await closeApp(app) }
  })
}
