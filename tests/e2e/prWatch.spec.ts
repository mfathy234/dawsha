import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, lastInput, launchApp, QUIT_BUDGET_MS } from './helpers'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

const readSettings = (dir: string): any => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
const calls = (dir: string): string[][] => readFileSync(join(dir, 'calls.log'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[])

test('a session shows its pull request, Fix CI sends the trimmed log, merge when green merges and tidy-up keeps the junction target', async () => {
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  const tree = `${repo}-pr-wt`
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/x', tree, 'HEAD')
  const head = git(tree, 'rev-parse', 'HEAD')
  const shared = join(sandbox.root, 'shared-modules')
  mkdirSync(join(shared, 'pkg'), { recursive: true })
  writeFileSync(join(shared, 'pkg', 'index.js'), 'keep me\n')
  symlinkSync(shared, join(tree, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')

  const settings = readSettings(sandbox.userData)
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    ...settings,
    pullRequests: { smoke: { mergeCommand: '', mergeConfirmed: false, tidyUp: true } },
    workspace: { focusedIndex: 0, panes: [{ projectId: 'smoke', folder: tree, worktree: { repo, path: tree, branch: 'feature/x' }, tabs: [{ agent: 'claude', label: 'claude', sessionId: 'pr-session-1' }], activeIndex: 0, fontSize: 13 }] }
  }), 'utf8')

  const state = mkdtempSync(join(tmpdir(), 'dawsha-fake-gh-'))
  writeFileSync(join(state, 'phase'), 'failing')
  const { app, page } = await launchApp(sandbox, { DAWSHA_GH_SCRIPT: resolve(__dirname, '../support/fakeGhWatch.cjs'), FAKE_GH_DIR: state, FAKE_GH_HEAD: head, DAWSHA_PR_POLL_SPEED: '40' })
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    const pane = page.locator('.pane').first()
    await expect(pane).toBeVisible({ timeout: 30_000 })
    const footer = pane.locator('.pane-pr')
    await expect(footer).toHaveText('PR #34: checks failed (1)', { timeout: 30_000 })
    await expect(page.locator('.sess-row').first()).toContainText('PR #34: checks failed (1)')
    await page.screenshot({ path: 'test-results/screens/pr-watch-failed.png' })

    const id = (await pane.locator('.term-host.active').getAttribute('data-term-id'))!
    await footer.click()
    await page.getByRole('menuitem', { name: /^Fix CI(?! automatically)/ }).click()
    await expect.poll(() => lastInput(page, id), { timeout: 15_000 }).toContain('CI failed on PR #34: CI / build')
    const sent = await lastInput(page, id)
    expect(sent).toContain('FAIL tests/watch.test.ts')
    expect(sent).not.toContain('noise 5')
    expect(sent).not.toContain('2026-01-01')
    expect(calls(state).filter((call) => call[0] === 'run')).toEqual([['run', 'view', '4242', '--log-failed']])

    writeFileSync(join(state, 'phase'), 'green')
    await expect(footer).toHaveText('PR #34: ready to merge', { timeout: 30_000 })
    await footer.click()
    await page.getByRole('menuitem', { name: /Merge when green/ }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('gh pr merge 34 --squash')
    await page.screenshot({ path: 'test-results/screens/pr-watch-confirm.png' })
    await dialog.getByRole('button', { name: 'Merge PR #34 when green' }).click()
    await expect.poll(() => calls(state).find((call) => call[1] === 'merge'), { timeout: 30_000 }).toEqual(['pr', 'merge', '34', '--squash', `--match-head-commit=${head}`])
    expect(readSettings(sandbox.userData).pullRequests.smoke.mergeConfirmed).toBe(true)

    await expect(page.locator('.pane')).toHaveCount(0, { timeout: 30_000 })
    await expect.poll(() => existsSync(tree), { timeout: 20_000 }).toBe(false)
    expect(readFileSync(join(shared, 'pkg', 'index.js'), 'utf8')).toBe('keep me\n')
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain('pr-wt')
    await expect.poll(() => readSettings(sandbox.userData).keptSessions?.map((item: any) => [item.sessionId, item.note])).toEqual([['pr-session-1', 'Merged as PR #34']])
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('with Watch pull requests off there is no gh polling and no status chip', async () => {
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  const tree = `${repo}-pr-off`
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/off', tree, 'HEAD')
  const settings = readSettings(sandbox.userData)
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    ...settings,
    watchPullRequests: false,
    workspace: { focusedIndex: 0, panes: [{ projectId: 'smoke', folder: tree, worktree: { repo, path: tree, branch: 'feature/off' }, tabs: [{ agent: 'claude', label: 'claude', sessionId: 'pr-session-off' }], activeIndex: 0, fontSize: 13 }] }
  }), 'utf8')
  const state = mkdtempSync(join(tmpdir(), 'dawsha-fake-gh-'))
  writeFileSync(join(state, 'phase'), 'failing')
  const { app, page } = await launchApp(sandbox, { DAWSHA_GH_SCRIPT: resolve(__dirname, '../support/fakeGhWatch.cjs'), FAKE_GH_DIR: state, FAKE_GH_HEAD: git(tree, 'rev-parse', 'HEAD'), DAWSHA_PR_POLL_SPEED: '40' })
  try {
    await expect(page.locator('.pane').first()).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(3000)
    await expect(page.locator('.pane-pr').first()).toBeHidden()
    await expect(page.locator('.sess-row').first()).not.toContainText('PR #')
    expect(existsSync(join(state, 'calls.log'))).toBe(false)
  } finally {
    await closeApp(app)
  }
})
