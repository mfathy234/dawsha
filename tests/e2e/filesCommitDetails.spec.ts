import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Commit Author', '-c', 'user.email=author@example.test', ...args], { cwd, encoding: 'utf8' }).trim()

test('Files Activity opens commit details and the selected file diff', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  writeFileSync(join(repo, 'notes.txt'), 'first line\nkeep this\n')
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Initial notes')
  writeFileSync(join(repo, 'notes.txt'), 'updated line\nkeep this\n')
  git(repo, 'commit', '-q', '-am', 'Update notes\n\nExplain the change')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('#files-button').click()
    await expect(page.locator('#files-view')).toBeVisible()
    await page.locator('.files-row[data-path="notes.txt"]').click()
    await expect(page.locator('.files-tab.active')).toContainText('notes.txt')
    await page.locator('#files-tab-activity').click()
    const recent = page.locator('#files-activity .files-side-row.commit').first()
    await expect(recent).toContainText('Update notes')
    await recent.click()
    const dialog = page.getByRole('dialog', { name: 'Commit details' })
    await expect(dialog).toContainText('Commit Author <author@example.test>')
    await expect(dialog).toContainText('Update notes')
    await expect(dialog).toContainText('Explain the change')
    await expect(dialog.locator('.commit-details-file')).toContainText('notes.txt')
    await expect(dialog.locator('.commit-details-file')).toContainText('+1 −1')
    await expect(dialog.locator('.commit-details-diff .dv-del')).toContainText('first line')
    await expect(dialog.locator('.commit-details-diff .dv-add')).toContainText('updated line')
  } finally {
    await closeApp(app)
  }
})
