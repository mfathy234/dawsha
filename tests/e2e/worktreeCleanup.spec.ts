import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, QUIT_BUDGET_MS } from './helpers'

const SCREENS = 'test-results/screens'

function git(cwd: string, ...args: string[]): string {
  const identity = ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid']
  return execFileSync('git', [...identity, ...args], { cwd, encoding: 'utf8' }).trim()
}

function branches(repo: string): string[] {
  return git(repo, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean)
}

function seedRepo(folder: string): Record<string, string> {
  git(folder, 'init', '-q', '-b', 'main')
  writeFileSync(join(folder, 'README.md'), 'hello\n')
  git(folder, 'add', '.')
  git(folder, 'commit', '-q', '-m', 'first')
  const tree = (short: string): string => `${folder}-preset-${short}`
  for (const short of ['aaa111', 'bbb222', 'ccc333', 'ddd444']) git(folder, 'worktree', 'add', '-q', '-b', `preset/${short}`, tree(short), 'HEAD')
  writeFileSync(join(tree('bbb222'), 'work.txt'), 'x\n')
  git(tree('bbb222'), 'add', '.')
  git(tree('bbb222'), 'commit', '-q', '-m', 'unmerged work')
  writeFileSync(join(tree('ccc333'), 'draft.txt'), 'draft\n')
  git(folder, 'worktree', 'add', '-q', '-b', 'feature/mine', `${folder}-mine`, 'HEAD')
  return { aaa: tree('aaa111'), bbb: tree('bbb222'), ccc: tree('ccc333'), ddd: tree('ddd444'), mine: `${folder}-mine` }
}

test('Clean up worktrees lists only Dawsha session worktrees, follows the ticks and removes them', async () => {
  const sandbox = createSandbox()
  const trees = seedRepo(sandbox.projectFolder)
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(page.locator('.toast', { hasText: 'Smoke has 4 worktrees left from closed sessions.' })).toBeVisible({ timeout: 20_000 })
    await page.screenshot({ path: join(SCREENS, '86-worktree-nudge.png') })
    await page.locator('.toast-x').click()

    await page.getByRole('button', { name: 'Project actions for Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Clean up worktrees…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading')).toHaveText('Remove 3 worktrees from closed sessions in Smoke?')
    const rows = dialog.locator('.wtc-row')
    await expect(rows).toHaveCount(4)
    await expect(dialog).not.toContainText('feature/mine')
    await expect(rows.filter({ hasText: 'preset/aaa111' })).toContainText(/^.*merged · .* · today/)
    await expect(rows.filter({ hasText: 'preset/bbb222' })).toContainText('not merged')
    const dirty = rows.filter({ hasText: 'preset/ccc333' })
    await expect(dirty).toContainText('1 uncommitted file')
    await expect(dirty.locator('input')).not.toBeChecked()
    await expect(dialog.getByRole('button', { name: 'Remove 3 worktrees' })).toBeVisible()
    await expect(dialog.locator('.wtc-opt')).toContainText('Also delete the merged branches (preset/aaa111, preset/ddd444)')

    await rows.filter({ hasText: 'preset/ddd444' }).locator('input').uncheck()
    await expect(dialog.getByRole('button', { name: 'Remove 2 worktrees' })).toBeVisible()
    await expect(dialog.locator('.wtc-opt')).toContainText('(preset/aaa111)')
    await rows.filter({ hasText: 'preset/ddd444' }).locator('input').check()
    await page.screenshot({ path: join(SCREENS, '87-worktree-cleanup.png') })

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(existsSync(trees.aaa)).toBe(true)

    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await page.locator('.term-host.active').click()
    await page.keyboard.press('Control+k')
    await page.locator('#palette-input').fill('Clean up worktrees')
    await expect(page.locator('.palette-row.selected')).toHaveAttribute('data-command', 'project.cleanup-worktrees')
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('heading')).toHaveText('Remove 3 worktrees from closed sessions in Smoke?')
    await dialog.locator('.wtc-opt input').check()
    await dialog.getByRole('button', { name: 'Remove 3 worktrees' }).click()
    await expect(page.locator('.toast', { hasText: 'Removed 3 worktrees and 2 branches.' })).toBeVisible()

    expect(existsSync(trees.aaa)).toBe(false)
    expect(existsSync(trees.bbb)).toBe(false)
    expect(existsSync(trees.ddd)).toBe(false)
    expect(existsSync(trees.ccc)).toBe(true)
    expect(existsSync(trees.mine)).toBe(true)
    const left = branches(sandbox.projectFolder)
    expect(left).toContain('preset/bbb222')
    expect(left).toContain('preset/ccc333')
    expect(left).toContain('feature/mine')
    expect(left).not.toContain('preset/aaa111')
    expect(left).not.toContain('preset/ddd444')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('a dirty worktree is only removed after it is ticked and the loss is confirmed', async () => {
  const sandbox = createSandbox()
  const trees = seedRepo(sandbox.projectFolder)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'Project actions for Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Clean up worktrees…' }).click()
    const dialog = page.getByRole('dialog')
    const dirty = dialog.locator('.wtc-row', { hasText: 'preset/ccc333' })
    await dirty.locator('input').check()
    await expect(dirty).toContainText('will be lost')
    await dialog.getByRole('button', { name: 'Remove 4 worktrees' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('preset/ccc333 (1 uncommitted file)')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    expect(existsSync(trees.ccc)).toBe(true)
    expect(existsSync(trees.aaa)).toBe(true)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
