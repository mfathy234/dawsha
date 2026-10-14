import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, QUIT_BUDGET_MS } from './helpers'

const NEW_IN_SMOKE = /^New (Claude|Codex|Gemini) session in Smoke$/
const SLOW = 20_000

function git(cwd: string, ...args: string[]): string {
  const identity = ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid']
  const env = { ...process.env, GCM_INTERACTIVE: 'never' }
  return execFileSync('git', [...identity, ...args], { cwd, encoding: 'utf8', env }).trim()
}

function seedRepo(folder: string): void {
  git(folder, 'init', '-q', '-b', 'main')
  writeFileSync(join(folder, 'a.txt'), 'one\n')
  writeFileSync(join(folder, 'b.txt'), 'one\n')
  writeFileSync(join(folder, 'c.txt'), 'one\n')
  writeFileSync(join(folder, 'my notes.md'), 'one\n')
  git(folder, 'add', '.')
  git(folder, 'commit', '-q', '-m', 'first')
}

async function openFromMenu(page: Page): Promise<ReturnType<Page['getByRole']>> {
  await page.locator('.pane-actions').click()
  await page.getByRole('menuitem', { name: 'Changes…' }).click()
  const dialog = page.getByRole('dialog', { name: /Changes in/ })
  await expect(dialog).toBeVisible()
  return dialog
}

test('reviews changes in a pane, commits only the checked files and discards with a named confirmation', async () => {
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  seedRepo(repo)
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
  writeFileSync(join(repo, 'b.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(repo, 'my notes.md'), 'changed\n')
  writeFileSync(join(repo, 'new file.txt'), 'brand new\n')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: SLOW })
    await expect(page.locator('.pane-info .info-changes')).toContainText('3 files', { timeout: SLOW })

    const dialog = await openFromMenu(page)
    const rows = dialog.locator('.changes-row')
    await expect(rows).toHaveCount(4)
    await expect(dialog.locator('.changes-branch')).toContainText('main')
    await expect(dialog.locator('.changes-branch')).toContainText('no upstream')
    await expect(dialog.getByRole('button', { name: 'Commit and push' })).toBeHidden()
    await expect(dialog.locator('.changes-row[data-path="a.txt"] .changes-state')).toHaveText('Modified')
    await expect(dialog.locator('.changes-row[data-path="new file.txt"] .changes-state')).toHaveText('New')
    await expect(dialog.locator('.changes-row[data-path="a.txt"] .changes-counts')).toHaveText('+1 −0')
    await expect(dialog.locator('input[data-path]:checked')).toHaveCount(4)
    await page.screenshot({ path: join('test-results/screens', '60-changes-panel.png') })

    await dialog.locator('.changes-row[data-path="a.txt"] .changes-pick').click()
    await expect(dialog.locator('[data-diff="a.txt"] .dv-code.add')).toHaveText('two')
    await expect(dialog.locator('.changes-columns')).toContainText('Before, last commit')
    await dialog.getByRole('button', { name: 'Unified' }).click()
    await expect(dialog.locator('[data-diff="a.txt"].dv-unified')).toBeVisible()
    await dialog.getByRole('button', { name: 'Side by side' }).click()
    await expect(dialog.locator('[data-diff="a.txt"].dv-split')).toBeVisible()
    await page.keyboard.press('j')
    await expect(dialog.locator('.changes-row.current')).toHaveAttribute('data-path', 'b.txt')
    await expect(dialog.locator('[data-diff="b.txt"]')).toContainText('three')
    await page.keyboard.press('Space')
    await expect(dialog.getByLabel('b.txt', { exact: true })).not.toBeChecked()
    await page.keyboard.press('Space')
    await expect(dialog.getByLabel('b.txt', { exact: true })).toBeChecked()

    await dialog.getByLabel('b.txt', { exact: true }).uncheck()
    await expect(dialog).toContainText('3 of 4 selected')
    await dialog.getByRole('button', { name: 'Commit', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Enter a commit message.')
    expect(git(repo, 'log', '--format=%s')).toBe('first')

    const hook = join(repo, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\necho "lint failed: fix the style" >&2\nexit 1\n')
    chmodSync(hook, 0o755)
    await dialog.getByLabel('Commit message').fill('Add dark mode toggle')
    await dialog.getByRole('button', { name: 'Commit', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('lint failed: fix the style', { timeout: SLOW })
    expect(git(repo, 'log', '--format=%s')).toBe('first')
    await expect(dialog.locator('.changes-row')).toHaveCount(4)
    rmSync(hook)

    await dialog.getByRole('button', { name: 'Commit', exact: true }).click()
    await expect(dialog.getByRole('alert')).toBeHidden({ timeout: SLOW })
    await expect(page.locator('.toast.info')).toContainText('Committed', { timeout: SLOW })
    expect(git(repo, 'log', '--format=%s')).toBe('Add dark mode toggle\nfirst')
    const committed = git(repo, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()
    expect(committed).toEqual(['a.txt', 'my notes.md', 'new file.txt'])
    expect(git(repo, 'status', '--porcelain')).toBe('M b.txt')
    await expect(dialog.locator('.changes-row')).toHaveCount(1)
    await expect(dialog.locator('.changes-row').first()).toHaveAttribute('data-path', 'b.txt')
    await expect(page.locator('.pane-info .info-changes')).toContainText('1 file', { timeout: SLOW })

    writeFileSync(join(repo, 'c.txt'), 'edited\n')
    writeFileSync(join(repo, 'scratch.txt'), 'temp\n')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)

    const again = await openFromMenu(page)
    await expect(again.locator('.changes-row')).toHaveCount(3)
    await again.getByLabel('b.txt', { exact: true }).uncheck()
    await again.getByRole('button', { name: 'Discard…' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('c.txt')
    await expect(confirm).toContainText('scratch.txt')
    await expect(confirm).toContainText('deleted from disk: scratch.txt')
    await expect(confirm.getByRole('button', { name: 'Discard 2 files' })).toBeVisible()
    await page.screenshot({ path: join('test-results/screens', '61-changes-discard.png') })
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(again).toBeVisible()
    expect(readFileSync(join(repo, 'c.txt'), 'utf8')).toBe('edited\n')
    expect(existsSync(join(repo, 'scratch.txt'))).toBe(true)

    await again.getByRole('button', { name: 'Discard…' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard 2 files' }).click()
    await expect.poll(() => readFileSync(join(repo, 'c.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('one\n')
    expect(existsSync(join(repo, 'scratch.txt'))).toBe(false)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('one\ntwo\nthree\n')
    await expect(again.locator('.changes-row')).toHaveCount(1)

    writeFileSync(join(repo, 'a.txt'), 'only this\n')
    await again.getByRole('button', { name: 'Close' }).click()
    const last = await openFromMenu(page)
    await last.getByLabel('b.txt', { exact: true }).uncheck()
    await last.getByRole('button', { name: 'Discard…' }).click()
    await expect(page.getByRole('alertdialog').getByRole('button', { name: 'Discard a.txt', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(last).toBeVisible()
    await last.getByRole('button', { name: 'Close' }).click()
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('opens from the info strip chip and Ctrl+Shift+G, and is disabled outside a repository', async () => {
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  seedRepo(repo)
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: SLOW })
    const chip = page.locator('.pane-info .info-changes')
    await expect(chip).toContainText('1 file', { timeout: SLOW })
    await chip.click()
    const dialog = page.getByRole('dialog', { name: /Changes in/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.changes-row')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await page.locator('.pane').first().click()
    await page.keyboard.press('Control+Shift+G')
    await expect(page.getByRole('dialog', { name: /Changes in/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: /Changes in/ })).toHaveCount(0)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }

  const plain = createSandbox()
  const second = await launchApp(plain)
  try {
    await second.page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(second.page.locator('.pane')).toHaveCount(1, { timeout: SLOW })
    await second.page.locator('.pane-actions').click()
    const item = second.page.getByRole('menuitem', { name: 'Changes…' })
    await expect(item).toBeDisabled()
    await expect(item).toHaveAttribute('title', /not a git repository/)
  } finally {
    expect(await closeApp(second.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('shows ahead and behind counts and pushes with the commit', async () => {
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  const remote = join(sandbox.root, 'remote.git')
  mkdirSync(remote)
  git(remote, 'init', '-q', '--bare', '-b', 'main')
  seedRepo(repo)
  git(repo, 'remote', 'add', 'origin', remote)
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  writeFileSync(join(repo, 'a.txt'), 'one\nlocal\n')
  git(repo, 'commit', '-q', '-am', 'local work')
  writeFileSync(join(repo, 'b.txt'), 'one\nship it\n')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: SLOW })
    await expect(page.locator('.pane-info .info-changes')).toContainText('1 file', { timeout: SLOW })
    const dialog = await openFromMenu(page)
    await expect(dialog.locator('.changes-branch')).toContainText('origin/main · 1 ahead, 0 behind')
    await dialog.getByLabel('Commit message').fill('Add dark mode toggle')
    await dialog.getByRole('button', { name: 'Commit and push' }).click()
    await expect(page.locator('.toast.info')).toContainText('and pushed', { timeout: SLOW })
    await expect(dialog.locator('.changes-branch')).toContainText('origin/main · 0 ahead, 0 behind')
    expect(git(remote, 'log', '--format=%s', 'main')).toBe('Add dark mode toggle\nlocal work\nfirst')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('shows only what changed in this session and browses project files', async () => {
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  seedRepo(repo)
  writeFileSync(join(repo, '.gitignore'), 'build/\n')
  mkdirSync(join(repo, 'build'))
  writeFileSync(join(repo, 'build', 'out.js'), 'ignored\n')
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'src', 'theme.ts'), 'export const theme = 1\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'second')
  writeFileSync(join(repo, 'a.txt'), 'one\nbefore the session\n')
  writeFileSync(join(repo, 'old notes.txt'), 'here before\n')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: SLOW })
    const settings = join(sandbox.userData, 'settings.json')
    await expect.poll(() => readFileSync(settings, 'utf8').includes('"baseline"'), { timeout: SLOW }).toBe(true)

    writeFileSync(join(repo, 'b.txt'), 'one\nduring the session\n')
    writeFileSync(join(repo, 'later.txt'), 'made by the agent\n')
    await expect(page.locator('.pane-info .info-changes')).toContainText('2 files', { timeout: SLOW })
    const dialog = await openFromMenu(page)
    await expect(dialog.locator('.changes-row')).toHaveCount(4)
    await dialog.getByRole('button', { name: 'This session' }).click()
    await expect(dialog.locator('.changes-row')).toHaveCount(2)
    await expect(dialog.locator('.changes-row[data-path="b.txt"]')).toHaveCount(1)
    await expect(dialog.locator('.changes-row[data-path="later.txt"]')).toHaveCount(1)
    await expect(dialog.locator('.changes-since')).toContainText('Only what changed after')
    await expect(dialog.locator('.changes-columns')).toContainText('when this session started')
    await dialog.locator('.changes-row[data-path="b.txt"] .changes-pick').click()
    await expect(dialog.locator('[data-diff="b.txt"] .dv-code.add')).toHaveText('during the session')
    await dialog.getByRole('button', { name: 'All changes' }).click()
    await expect(dialog.locator('.changes-row')).toHaveCount(4)

    await dialog.getByRole('tab', { name: /Files/ }).click()
    await expect(dialog.getByRole('tab', { name: /Files/ })).toContainText('8')
    await expect(dialog.locator('.files-node[data-path="build/out.js"]')).toHaveCount(0)
    await expect(dialog.locator('.files-node[data-path="later.txt"] .changes-state')).toHaveText('New')
    await dialog.locator('.files-node[data-path="src"]').click()
    await dialog.locator('.files-node[data-path="src/theme.ts"]').click()
    await expect(dialog.locator('[data-file="src/theme.ts"]')).toContainText('export const theme = 1')
    await expect(dialog.getByRole('button', { name: 'Show changes' })).toBeHidden()
    await dialog.getByRole('button', { name: 'Open in editor' }).last().click()
    await expect.poll(() => (existsSync(sandbox.openLog) ? readFileSync(sandbox.openLog, 'utf8') : '')).toContain('theme.ts')

    await dialog.getByLabel('Find a file by name').fill('a.tx')
    await expect(dialog.locator('.files-node')).toHaveCount(1)
    await dialog.locator('.files-node[data-path="a.txt"]').click()
    await expect(dialog.locator('[data-file="a.txt"] .dv-code.add')).toHaveText('before the session')
    await dialog.getByRole('button', { name: 'Show changes' }).click()
    await expect(dialog.getByRole('tab', { name: /Changes/ })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.locator('.changes-row.current')).toHaveAttribute('data-path', 'a.txt')
    await page.screenshot({ path: join('test-results/screens', '62-changes-files.png') })
    await dialog.getByRole('button', { name: 'Close' }).click()
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
