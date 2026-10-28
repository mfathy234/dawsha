import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { activeTermId, closeApp, createSandbox, lastInput, launchApp, type Sandbox } from './helpers'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

// main has README.md and src/a.ts; the working tree edits README.md and adds src/new.ts, so Review has two files.
function makeRepo(sandbox: Sandbox): string {
  const repo = sandbox.projectFolder
  mkdirSync(join(repo, 'src'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), 'hello\nworld\n')
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const one = 1\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  writeFileSync(join(repo, 'README.md'), 'hello\nagain\nworld\n')
  writeFileSync(join(repo, 'src', 'new.ts'), 'export const fresh = 1\n')
  return repo
}

const openReview = async (page: Page): Promise<void> => {
  await page.locator('#files-button').click()
  await expect(page.locator('#files-view')).toBeVisible()
  await page.locator('#files-mode-review').click()
}

test('Review steps through changed files with N and P, ticks them viewed, and keeps inline comments editable', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await openReview(page)
    await expect(page.locator('#files-mode-review')).toHaveText('Review 2')
    await expect(page.locator('#files-review-progress')).toHaveText('0 of 2 viewed')

    await page.locator('.files-review-row[data-path="README.md"] .files-review-open').click()
    await expect(page.locator('.files-tab.active')).toContainText('README.md')
    await expect(page.locator('#files-changes')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.files-editor:not([hidden]) .cm-changedLine').first()).toBeVisible()

    await page.locator('.files-review-row.current .files-review-open').focus()
    await page.keyboard.press('n')
    await expect(page.locator('.files-tab.active')).toContainText('new.ts')
    await page.locator('.files-review-row.current .files-review-open').focus()
    await page.keyboard.press('p')
    await expect(page.locator('.files-tab.active')).toContainText('README.md')

    await page.locator('.files-review-tick[data-path="README.md"]').check()
    await expect(page.locator('#files-review-progress')).toHaveText('1 of 2 viewed')
    await expect(page.locator('.files-review-row[data-path="README.md"]')).toContainText('Viewed')

    // a comment on an added line: add, edit, cancel a delete, delete
    await page.locator('.files-editor:not([hidden]) .cm-review-add').first().click()
    await page.locator('.cm-review-input').fill('Why change this?')
    await page.getByRole('button', { name: 'Save comment' }).click()
    await expect(page.locator('.cm-review-text')).toHaveText('Why change this?')
    await expect(page.locator('.files-review-row[data-path="README.md"]')).toContainText('1 comment')
    await expect(page.locator('#files-review-send')).toHaveText('Send 1 comment to agent')
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.locator('.cm-review-input').fill('Please explain this line.')
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('.cm-review-text')).toHaveText('Please explain this line.')
    await page.screenshot({ path: 'test-results/screens/174-files-review.png' })
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('README.md')
    await expect(confirm.getByRole('button', { name: /Delete comment on line \d+/ })).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.cm-review-text')).toHaveText('Please explain this line.')
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: /Delete comment on line \d+/ }).click()
    await expect(page.locator('.cm-review-comment')).toHaveCount(0)
    await expect(page.locator('#files-review-send')).toBeDisabled()
  } finally {
    await closeApp(app)
  }
})

test('Send comments inserts one message into the chosen session prompt without submitting it', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    const id = await activeTermId(page)
    await openReview(page)
    await page.locator('.files-review-row[data-path="README.md"] .files-review-open').click()
    await page.locator('.files-editor:not([hidden]) .cm-review-add').first().click()
    await page.locator('.cm-review-input').fill('Explain this')
    await page.keyboard.press('Control+Enter')
    await page.locator('#files-review-note').fill('Mostly fine')
    await page.locator('#files-review-send').click()
    await expect(page.locator('.pane')).toBeVisible()
    await expect.poll(() => lastInput(page, id)).toContain('README.md:2  Explain this')
    const sent = await lastInput(page, id)
    expect(sent).toContain('Overall: Mostly fine')
    expect(sent.endsWith('\r')).toBe(false)
    expect(sent.endsWith('\n')).toBe(false)
  } finally {
    await closeApp(app)
  }
})

test('Commit… drafts a message, commits only the ticked files and shows a refusing hook honestly', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox)
  const hook = join(repo, '.git', 'hooks', 'pre-commit')
  writeFileSync(hook, '#!/bin/sh\necho HOOK_REJECTED_THIS_COMMIT >&2\nexit 1\n')
  chmodSync(hook, 0o755)
  const { app, page } = await launchApp(sandbox)
  try {
    await openReview(page)
    await page.locator('#files-review-commit').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('#commit-message')).not.toHaveValue('')
    await dialog.locator('input[data-path="src/new.ts"]').uncheck()
    await expect(dialog.locator('#commit-confirm')).toHaveText('Commit 1 file')
    await dialog.locator('#commit-message').fill('Reword the readme')
    await dialog.locator('#commit-confirm').click()
    await expect(dialog.locator('#commit-error')).toContainText('HOOK_REJECTED_THIS_COMMIT')
    await expect(dialog.locator('#commit-error')).toContainText('Not committed')
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('first')

    writeFileSync(hook, '#!/bin/sh\nexit 0\n')
    await dialog.locator('#commit-confirm').click()
    await expect(dialog).toHaveCount(0)
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('Reword the readme')
    expect(git(repo, 'show', '--name-only', '--format=', 'HEAD')).toBe('README.md')
    expect(git(repo, 'status', '--porcelain')).toContain('src/new.ts')
    await expect(page.locator('#files-mode-review')).toHaveText('Review 1')
  } finally {
    await closeApp(app)
  }
})

test('Discard file… asks first, names the file on the button, and puts the file back', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await openReview(page)
    await page.locator('.files-review-row[data-path="README.md"] .files-review-open').click()
    await expect(page.locator('#files-review-discard')).toHaveText('Discard README.md…')
    await page.locator('#files-review-discard').click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('README.md')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('hello\nagain\nworld\n')
    await page.locator('#files-review-discard').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard README.md', exact: true }).click()
    await expect.poll(() => readFileSync(join(repo, 'README.md'), 'utf8').replace(/\r\n/g, '\n')).toBe('hello\nworld\n')
    await expect(page.locator('#files-mode-review')).toHaveText('Review 1')
  } finally {
    await closeApp(app)
  }
})
