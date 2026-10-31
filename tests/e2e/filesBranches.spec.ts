import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

test('the branch dropdown lists branches, switches with a confirmation and refreshes the label and tree', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'base.txt'), 'base')
  git('add', '.')
  git('commit', '-qm', 'initial')
  git('switch', '-qc', 'feature/only')
  writeFileSync(join(root, 'only-on-feature.txt'), 'feature')
  git('add', '.')
  git('commit', '-qm', 'feature work')
  git('switch', '-q', 'main')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#files-button').click()
    await expect(page.locator('#files-branch .files-loc-branch')).toHaveText('main')
    await expect(page.locator('.files-row[data-path="only-on-feature.txt"]')).toHaveCount(0)
    await page.locator('#files-branches').click()
    const menu = page.locator('.files-branch-menu')
    await expect(menu.locator('.files-bm-item[aria-current="true"]')).toContainText('main')
    await expect(menu.locator('.files-bm-item[data-branch="feature/only"] .files-bm-ago')).toHaveText('just now')
    await expect(menu.locator('.files-bm-filter')).toHaveCount(0)
    writeFileSync(join(root, 'base.txt'), 'edited')
    await expect(page.locator('#files-changes-list')).toContainText('base.txt')
    await menu.locator('.files-bm-item[data-branch="feature/only"]').click()
    await expect(page.getByRole('alertdialog')).toContainText('You have 1 changed file')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('#files-branch .files-loc-branch')).toHaveText('main')
    await page.locator('#files-branches').click()
    await page.locator('.files-bm-item[data-branch="feature/only"]').click()
    await page.getByRole('button', { name: 'Switch to feature/only' }).click()
    await expect(page.locator('#files-branch .files-loc-branch')).toHaveText('feature/only')
    await expect(page.locator('.files-row[data-path="only-on-feature.txt"]')).toBeVisible()
    expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/only')
  } finally { await closeApp(app) }
})
