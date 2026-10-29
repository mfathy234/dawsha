import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const NEW_IN_SMOKE = /^New (Claude|Codex|Gemini) session in Smoke$/
const SLOW = 20_000

function git(cwd: string, ...args: string[]): void {
  const identity = ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid']
  execFileSync('git', [...identity, ...args], { cwd, encoding: 'utf8', env: { ...process.env, GCM_INTERACTIVE: 'never' } })
}

test('the pane footer has no activity toggle, offers Review N files only with changes and stays compact in narrow layouts', async () => {
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  writeFileSync(join(repo, 'b.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: SLOW })
    await expect(page.locator('.agents-toggle')).toHaveCount(0)
    await expect(page.locator('.info-review')).toHaveCount(0)

    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
    writeFileSync(join(repo, 'b.txt'), 'changed\n')
    const review = page.locator('.pane-info .info-review')
    await expect(review).toHaveText('Review 2 files', { timeout: SLOW })
    await expect(review).toHaveAttribute('title', 'Review what this session changed')

    await page.locator('.pane-info .info-review:visible').first().click()
    await expect(page.locator('#files-mode-review')).toHaveAttribute('aria-selected', 'true', { timeout: SLOW })
    await expect(page.locator('.files-pane-review')).toContainText('a.txt')
    await expect(page.locator('.files-pane-review')).toContainText('b.txt')
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await expect(review).toBeVisible()

    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(5, { timeout: SLOW })
    for (const pane of await page.locator('.pane').all()) {
      const title = await pane.locator('.pane-title').boundingBox()
      expect(title?.width ?? 0, 'the pane title keeps room').toBeGreaterThan(40)
      const foot = await pane.locator('.pane-foot').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
      expect(foot, 'the footer does not overflow').toBe(true)
    }
    await page.screenshot({ path: 'test-results/screens/pane-footer-1024-five.png' })

  } finally {
    await closeApp(app)
  }
})
