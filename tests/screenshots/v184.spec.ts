import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from '../e2e/helpers'
import { launchDemo } from './v17Demo'

const OUT = resolve(__dirname, '../../test-results/polish-v184')

test('captures the calm top bar, the notification panel and the Review panel in dark and light', async () => {
  mkdirSync(OUT, { recursive: true })
  for (const [theme, name] of [['grid-dark', 'dark'], ['dawsha-daylight', 'light']] as const) {
    const { app, page } = await launchDemo({ theme: { id: theme } })
    try {
      await expect(page.locator('html')).toHaveAttribute('data-kind', name)
      await page.locator('.topbar').screenshot({ path: resolve(OUT, `topbar-${name}.png`) })
      await page.locator('#files-button').hover()
      await page.locator('.topbar').screenshot({ path: resolve(OUT, `topbar-hover-${name}.png`) })
      await page.locator('#notifications-button').click()
      await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible()
      await page.screenshot({ path: resolve(OUT, `bell-${name}.png`) })
      await page.keyboard.press('Escape')
      await page.locator('#files-button').click()
      await expect(page.locator('#files-view')).toBeVisible()
      await page.locator('#files-mode-review').click()
      await page.screenshot({ path: resolve(OUT, `files-review-${name}.png`) })
      await page.locator('#files-view').screenshot({ path: resolve(OUT, `files-view-${name}.png`) })
    } finally {
      await closeApp(app)
    }
  }
})

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd })
}

test('captures the tidy Review panel with changed files', async () => {
  mkdirSync(OUT, { recursive: true })
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  mkdirSync(join(repo, 'src'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), 'hello\nworld\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  writeFileSync(join(repo, 'README.md'), 'hello\nagain\nworld\n')
  writeFileSync(join(repo, 'src', 'new.ts'), 'export const fresh = 1\n')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1200, height: 760 })
    await page.locator('#files-button').click()
    await page.locator('#files-mode-review').click()
    await expect(page.locator('.files-review-row')).toHaveCount(2)
    await page.locator('#files-view').screenshot({ path: resolve(OUT, 'review-changes.png') })
    await page.locator('#files-review-note-toggle').click()
    await page.locator('#files-review-note').fill('Looks mostly fine.')
    await page.locator('#files-review-more').click()
    await page.locator('#files-view').screenshot({ path: resolve(OUT, 'review-note-menu.png') })
  } finally {
    await closeApp(app)
  }
})
