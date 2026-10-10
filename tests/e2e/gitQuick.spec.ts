import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, QUIT_BUDGET_MS, type Sandbox } from './helpers'

const NEW_IN_SMOKE = /^New (Claude|Codex|Gemini) session in Smoke$/
const SLOW = 20_000

function git(cwd: string, ...args: string[]): string {
  const identity = ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid']
  const env = { ...process.env, GCM_INTERACTIVE: 'never' }
  return execFileSync('git', [...identity, ...args], { cwd, encoding: 'utf8', env }).trim()
}

function text(path: string): string {
  return readFileSync(path, 'utf8').split(String.fromCharCode(13)).join('')
}

interface Rig {
  repo: string
  remote: string
  other: string
}

function seedRig(sandbox: Sandbox): Rig {
  const repo = sandbox.projectFolder
  const remote = join(sandbox.root, 'remote.git')
  const other = join(sandbox.root, 'other')
  mkdirSync(remote)
  git(remote, 'init', '-q', '--bare', '-b', 'main')
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  writeFileSync(join(repo, 'b.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  git(repo, 'remote', 'add', 'origin', remote)
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  git(sandbox.root, 'clone', '-q', remote, other)
  return { repo, remote, other }
}

async function startPane(page: Page): Promise<void> {
  await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
  await expect(page.locator('.pane')).toHaveCount(1, { timeout: SLOW })
  await expect(page.locator('.pane-info .info-changes')).toBeVisible({ timeout: SLOW })
  await expect(page.locator('.chip-branch')).toBeVisible({ timeout: SLOW })
}

async function openPicker(page: Page): Promise<void> {
  await page.locator('.chip-branch').click()
  await page.getByRole('menuitem', { name: 'Switch branch…' }).click()
  await expect(page.getByRole('dialog', { name: 'Switch branch' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Switch branch' })).toBeFocused()
}

async function runFromPalette(page: Page, query: string, commandId: string): Promise<void> {
  await page.locator('.term-host.active').click()
  await page.keyboard.press('Control+k')
  const input = page.getByPlaceholder('Type a command, a session or a project')
  await expect(input).toBeVisible()
  await input.fill(query)
  await page.locator(`.palette-row[data-command="${commandId}"]`).click()
}

test('switches to local and remote-only branches, creates a branch from the picker and rejects bad names', async () => {
  const sandbox = createSandbox()
  const { repo, other } = seedRig(sandbox)
  git(repo, 'branch', 'feature/dark-mode')
  git(other, 'switch', '-q', '-c', 'release/2.0')
  writeFileSync(join(other, 'a.txt'), 'one\nrelease\n')
  git(other, 'commit', '-q', '-am', 'release work')
  git(other, 'push', '-q', 'origin', 'release/2.0')
  git(repo, 'fetch', '-q')
  const { app, page } = await launchApp(sandbox)
  try {
    await startPane(page)
    await expect(page.locator('.chip-branch .chip-text')).toHaveText('main')

    await openPicker(page)
    const rows = page.locator('.branch-picker .palette-row')
    await expect(rows).toHaveText([/feature\/dark-mode/, /main\s*current/, /release\/2\.0\s*origin\/release\/2\.0/])
    await page.screenshot({ path: join('test-results/screens', '70-branch-picker.png') })
    await page.locator('[data-branch="feature/dark-mode"]').click()
    await expect(page.locator('.toast.info')).toContainText('Switched to feature/dark-mode', { timeout: SLOW })
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/dark-mode')
    await expect(page.locator('.chip-branch .chip-text')).toHaveText('feature/dark-mode', { timeout: SLOW })

    await openPicker(page)
    await page.locator('[data-branch="release/2.0"]').click()
    await expect(page.locator('.toast.info').last()).toContainText('Switched to release/2.0 tracking origin/release/2.0', { timeout: SLOW })
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('release/2.0')
    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/release/2.0')
    await expect(page.locator('.chip-branch .chip-text')).toHaveText('release/2.0', { timeout: SLOW })

    await openPicker(page)
    const input = page.getByRole('combobox', { name: 'Switch branch' })
    await input.fill('feature/billing-export')
    await expect(page.locator('[data-kind="create"]')).toContainText('Create branch feature/billing-export from release/2.0')
    await input.press('Enter')
    await expect(page.locator('.toast.info').last()).toContainText('Created and switched to feature/billing-export', { timeout: SLOW })
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/billing-export')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'release/2.0'))

    await openPicker(page)
    await input.fill('bad..name')
    await expect(page.locator('[data-kind="invalid"]')).toContainText('cannot contain')
    await expect(page.locator('[data-kind="create"]')).toHaveCount(0)
    await input.press('Enter')
    await input.fill('-evil')
    await expect(page.locator('[data-kind="invalid"]')).toContainText('cannot start with a dash')
    await input.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Switch branch' })).toBeVisible()
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/billing-export')
    expect(git(repo, 'branch', '--list', 'bad..name', '*evil')).toBe('')

    const refused = await page.evaluate(
      (folder) =>
        (window as unknown as { gridApi: { gitQuick(r: unknown): Promise<{ ok: boolean; error?: string }> } }).gridApi.gitQuick({
          folder,
          op: 'switch',
          branch: '-c',
          mode: 'create'
        }),
      repo
    )
    expect(refused.ok).toBe(false)
    await input.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Switch branch' })).toHaveCount(0)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('refuses a dirty switch, stashes and switches, then applies the last stash', async () => {
  const sandbox = createSandbox()
  const { repo } = seedRig(sandbox)
  git(repo, 'switch', '-q', '-c', 'feature/dark-mode')
  writeFileSync(join(repo, 'a.txt'), 'one\ndark\n')
  git(repo, 'commit', '-q', '-am', 'dark mode')
  git(repo, 'switch', '-q', 'main')
  writeFileSync(join(repo, 'a.txt'), 'one\nlocal edit\n')
  writeFileSync(join(repo, 'notes.txt'), 'untracked\n')
  const { app, page } = await launchApp(sandbox)
  try {
    await startPane(page)
    await openPicker(page)
    await page.locator('[data-branch="feature/dark-mode"]').click()
    const refusal = page.locator('.branch-refusal')
    await expect(refusal).toContainText('would be overwritten', { timeout: SLOW })
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    await page.screenshot({ path: join('test-results/screens', '71-branch-refusal.png') })

    await page.locator('[data-action="stash-switch"]').click()
    await expect(page.locator('.toast.info').last()).toContainText('Apply last stash', { timeout: SLOW })
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/dark-mode')
    expect(git(repo, '-c', 'core.autocrlf=true', 'status', '--porcelain')).toBe('')
    expect(git(repo, 'stash', 'list')).toContain('Dawsha: main')
    expect(existsSync(join(repo, 'notes.txt'))).toBe(false)

    await runFromPalette(page, 'Apply last stash', 'git.stash-pop')
    await expect(page.locator('.toast.error').last()).toContainText('The stash was kept', { timeout: SLOW })
    expect(git(repo, 'stash', 'list')).toContain('Dawsha: main')

    git(repo, 'reset', '-q', '--hard')
    git(repo, 'clean', '-fdq')
    git(repo, 'switch', '-q', 'main')
    await expect(page.locator('.chip-branch .chip-text')).toHaveText('main', { timeout: SLOW })
    await runFromPalette(page, 'Apply last stash', 'git.stash-pop')
    await expect(page.locator('.toast.info').last()).toContainText('Applied stash: On main: Dawsha: main', { timeout: SLOW })
    expect(text(join(repo, 'a.txt'))).toBe('one\nlocal edit\n')
    expect(text(join(repo, 'notes.txt'))).toBe('untracked\n')
    expect(git(repo, 'stash', 'list')).toBe('')

    git(repo, 'checkout', '-q', '--', 'a.txt')
    git(repo, 'clean', '-fdq')
    writeFileSync(join(repo, 'b.txt'), 'one\nwip\n')
    await runFromPalette(page, 'Stash changes', 'git.stash')
    await expect(page.locator('.toast.info').last()).toContainText('Changes stashed', { timeout: SLOW })
    expect(git(repo, 'stash', 'list')).toMatch(/Dawsha: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('fetch shows ahead and behind on the chip, pull fast-forwards and refuses a diverged branch', async () => {
  const sandbox = createSandbox()
  const { repo, other } = seedRig(sandbox)
  writeFileSync(join(other, 'a.txt'), 'one\nremote\n')
  git(other, 'commit', '-q', '-am', 'remote work')
  git(other, 'push', '-q', 'origin', 'main')
  const { app, page } = await launchApp(sandbox)
  try {
    await startPane(page)
    await expect(page.locator('.chip-sync')).toBeHidden()

    await runFromPalette(page, 'Fetch', 'git.fetch')
    await expect(page.locator('.toast.info').last()).toContainText('Fetched. 0 ahead, 1 behind.', { timeout: SLOW })
    await expect(page.locator('.chip-sync')).toHaveText('↓1', { timeout: SLOW })
    await page.screenshot({ path: join('test-results/screens', '72-branch-sync.png') })

    await runFromPalette(page, 'Pull', 'git.pull')
    await expect(page.locator('.toast.info').last()).toContainText('Pulled', { timeout: SLOW })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8').replace(/\r/g, '')).toBe('one\nremote\n')
    await expect(page.locator('.chip-sync')).toBeHidden({ timeout: SLOW })

    writeFileSync(join(repo, 'b.txt'), 'one\nlocal\n')
    git(repo, 'commit', '-q', '-am', 'local work')
    writeFileSync(join(other, 'a.txt'), 'one\nremote\nagain\n')
    git(other, 'commit', '-q', '-am', 'more remote work')
    git(other, 'push', '-q', 'origin', 'main')
    const head = git(repo, 'rev-parse', 'HEAD')
    await runFromPalette(page, 'Fetch', 'git.fetch')
    await expect(page.locator('.chip-sync')).toHaveText('↑1 ↓1', { timeout: SLOW })
    await runFromPalette(page, 'Pull', 'git.pull')
    const failure = page.locator('.toast.error').last()
    await expect(failure).toContainText('fast-forward', { timeout: SLOW })
    await expect(failure).toContainText('Changes panel')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(repo, '-c', 'core.autocrlf=true', 'status', '--porcelain')).toBe('')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
