import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp, type Sandbox, QUIT_BUDGET_MS } from './helpers'

const SCREENS = 'test-results/screens'
const FAKE = resolve(__dirname, '../support/fakeAgent.cjs')
const PROMPT = 'Why does the "login" test fail & what is 100% of %PATH%?\nSecond line, with a trailing backslash \\'

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

function git(cwd: string, ...args: string[]): string {
  const identity = ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid']
  return execFileSync('git', [...identity, ...args], { cwd, encoding: 'utf8' }).trim()
}

function makeRepo(parent: string, name: string, commit = true): string {
  const repo = join(parent, name)
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  if (commit) {
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'first')
  }
  return repo
}

function fakeEnv(logDir: string): Record<string, string> {
  const node = process.execPath
  return {
    FAKE_AGENT_LOG: logDir,
    DAWSHA_CLAUDE_COMMAND: node,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([FAKE, 'claude']),
    DAWSHA_CODEX_COMMAND: node,
    DAWSHA_CODEX_ARGS: JSON.stringify([FAKE, 'codex']),
    DAWSHA_GEMINI_COMMAND: node,
    DAWSHA_GEMINI_ARGS: JSON.stringify([FAKE, 'gemini'])
  }
}

function seedProjects(sandbox: Sandbox, projects: { id: string; name: string; folder: string }[]): void {
  const path = join(sandbox.userData, 'settings.json')
  writeFileSync(path, JSON.stringify({ version: 2, lastSeenVersion: APP_VERSION, projects }), 'utf8')
}

async function openDialog(page: Page): Promise<ReturnType<Page['getByRole']>> {
  await page.getByRole('button', { name: 'Choose agent', exact: true }).click()
  await page.getByRole('menuitem', { name: /Ask two agents/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Ask two agents' })
  await expect(dialog).toBeVisible()
  return dialog
}

const SLOW = 30_000

async function readAgent(
  logDir: string,
  name: string,
  args?: string[]
): Promise<{ cwd: string; args: string[] }> {
  const file = join(logDir, `${name}.json`)
  let log: { cwd: string; args: string[] } | undefined
  await expect
    .poll(
      () => {
        try {
          log = JSON.parse(readFileSync(file, 'utf8'))
          if (args && JSON.stringify(log?.args) !== JSON.stringify(args)) log = undefined
        } catch {
          log = undefined
        }
        return log !== undefined
      },
      { timeout: SLOW, message: `the fake ${name} agent did not write ${file}` }
    )
    .toBe(true)
  return log as { cwd: string; args: string[] }
}

test('asks two agents in separate worktrees, links the panes and compares or keeps one', async () => {
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox.root, 'acme-web')
  seedProjects(sandbox, [{ id: 'acme', name: 'acme-web', folder: repo }])
  const logDir = join(sandbox.root, 'agent-log')
  const { app, page } = await launchApp(sandbox, fakeEnv(logDir))
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    const dialog = await openDialog(page)
    const worktrees = dialog.getByLabel("Start each in its own git worktree so their edits don't collide")
    await expect(worktrees).toBeChecked()
    await expect(dialog.getByLabel('Agent A')).toHaveValue('claude')
    await expect(dialog.getByLabel('Agent B')).toHaveValue('codex')
    await expect(dialog.locator('.compare-note')).toContainText('-compare-')
    await expect(dialog.locator('.compare-note')).toContainText('from main')
    await dialog.getByRole('button', { name: 'Ask both' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Enter the prompt to send to both agents.')

    const note = (await dialog.locator('.compare-note').textContent()) ?? ''
    const short = /compare-([a-z0-9]{6})-a/.exec(note)?.[1] ?? ''
    expect(short).not.toBe('')
    git(repo, 'branch', `compare/${short}-b`)
    await dialog.getByLabel('Prompt').fill(PROMPT)
    await page.screenshot({ path: join(SCREENS, '40-compare-dialog.png') })
    await dialog.getByRole('button', { name: 'Ask both' }).click()
    await expect(dialog.getByRole('alert')).toContainText('already exists')
    expect(existsSync(`${repo}-compare-${short}-a`)).toBe(false)
    await expect(dialog.locator('.compare-note')).not.toContainText(short)

    await dialog.getByRole('button', { name: 'Ask both' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.compare-group')).toHaveCount(1)
    await expect(page.locator('.compare-group .pane')).toHaveCount(2)
    await expect(page.locator('.compare-group .chip-compare')).toHaveText(['A', 'B'])
    await expect(page.locator('.compare-head')).toContainText('Compare')
    await expect(page.locator('.compare-head')).toContainText('Why does the "login" test fail')
    await expect(page.locator('.compare-group .pane').first().locator('.pane-header .agent-mark.claude')).toHaveCount(1)
    await expect(page.locator('.compare-group .pane').nth(1).locator('.pane-header .agent-mark.codex')).toHaveCount(1)

    const claude = await readAgent(logDir, 'claude')
    const codex = await readAgent(logDir, 'codex')
    expect(claude.args).toEqual([PROMPT])
    expect(codex.args).toEqual([PROMPT])
    const sideA = claude.cwd
    const sideB = codex.cwd
    expect(sideA).toMatch(/acme-web-compare-[a-z0-9]{6}-a$/)
    expect(sideB).toMatch(/acme-web-compare-[a-z0-9]{6}-b$/)
    await expect(page.locator('.compare-group .pane').first().locator('.chip-text')).toHaveText(/^compare\/[a-z0-9]{6}-a$/)
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(3)
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.map((p: any) => p.compare?.slot)).toEqual(['a', 'b'])
    expect(readSettings(sandbox.userData).workspace.panes[0].folder).toBe(sideA)
    await page.screenshot({ path: join(SCREENS, '41-compare-pair.png') })

    writeFileSync(join(sideA, 'a-only.txt'), 'from a\n')
    writeFileSync(join(sideB, 'b-only.txt'), 'from b\n')
    git(sideB, 'add', '.')
    git(sideB, 'commit', '-q', '-m', 'work on b')
    await page.getByRole('button', { name: 'Diff A vs B' }).click()
    await expect(page.locator('.compare-group .pane').first().locator('.tabs [role="tab"]')).toHaveText([/^claude/, /shell/])
    const shellId = await page.locator('.term-host.active').first().getAttribute('data-term-id')
    await expect.poll(async () => (await page.evaluate((id) => (window as any).__grid.bufferText(id), shellId)).replaceAll('\n', ''), { timeout: 20_000 }).toContain('git diff --no-index')
    await expect
      .poll(async () => (await page.evaluate((id) => (window as any).__grid.bufferText(id), shellId)).replaceAll('\n', ''), { timeout: 20_000 })
      .toContain('a-only.txt')
    await page.screenshot({ path: join(SCREENS, '42-compare-diff.png') })

    await page.getByRole('button', { name: 'Keep A', exact: true }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('heading')).toHaveText(/^Close B: .+\?$/)
    await expect(confirm).toContainText('Keeping A stops the Codex session')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.compare-group .pane')).toHaveCount(2)

    await page.getByRole('button', { name: 'Keep A', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: /^Close B: / }).click()
    const work = page.getByRole('alertdialog')
    await expect(work.getByRole('heading')).toHaveText('B has work that is not saved elsewhere')
    await expect(work).toContainText('1 commit of its own')
    await expect(work).toContainText('Deleting them loses that work. They are kept unless you confirm.')
    await page.screenshot({ path: join(SCREENS, '43-compare-keep.png') })
    await work.getByRole('button', { name: 'Keep worktree and branch' }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.compare-group')).toHaveCount(0)
    await expect(page.locator('.chip-compare:visible')).toHaveCount(0)
    expect(existsSync(sideB)).toBe(true)
    expect(git(repo, 'branch', '--list', `compare/${/compare-([a-z0-9]{6})-b/.exec(sideB)?.[1]}-b`)).toContain('compare/')
    await expect.poll(() => readSettings(sandbox.userData).workspace.panes.map((p: any) => p.compare)).toEqual([undefined])
    expect(readSettings(sandbox.userData).workspace.panes[0].folder).toBe(sideA)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('keeps both sides, removes a clean worktree after a named confirmation and passes a Gemini prompt', async () => {
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox.root, 'billing-api')
  seedProjects(sandbox, [{ id: 'billing', name: 'billing-api', folder: repo }])
  const logDir = join(sandbox.root, 'agent-log')
  const { app, page } = await launchApp(sandbox, fakeEnv(logDir))
  try {
    await page.keyboard.press('Control+Shift+a')
    const dialog = page.getByRole('dialog', { name: 'Ask two agents' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Agent A').selectOption('gemini')
    await dialog.getByLabel('Agent B').selectOption('claude')
    await dialog.getByLabel('Prompt').fill('-v is not a flag')
    await dialog.getByRole('button', { name: 'Ask both' }).click()
    await expect(dialog).toHaveCount(0)
    expect((await readAgent(logDir, 'gemini')).args).toEqual(['--prompt-interactive=-v is not a flag'])
    expect((await readAgent(logDir, 'claude')).args).toEqual(['--', '-v is not a flag'])
    const sideA = (await readAgent(logDir, 'gemini')).cwd

    await page.getByRole('button', { name: 'Keep both' }).click()
    await expect(page.locator('.compare-group')).toHaveCount(0)
    await expect(page.locator('.pane')).toHaveCount(2)
    await expect(page.locator('.toast').last()).toContainText('Kept both panes. Their worktrees stay')
    expect(existsSync(sideA)).toBe(true)

    await page.keyboard.press('Control+k')
    await expect(page.locator('#palette-input')).toBeFocused()
    await page.keyboard.type('ask two')
    await page.keyboard.press('Enter')
    const second = page.getByRole('dialog', { name: 'Ask two agents' })
    await expect(second.getByRole('button', { name: 'Ask both' })).toBeEnabled()
    await second.getByLabel('Agent A').selectOption('codex')
    await second.getByLabel('Agent B').selectOption('claude')
    await second.getByLabel('Prompt').fill('Tidy the invoices module')
    await second.getByRole('button', { name: 'Ask both' }).click()
    await expect(second).toHaveCount(0)
    await expect(page.locator('.compare-group .pane')).toHaveCount(2)
    const tidy = ['Tidy the invoices module']
    const codexCwd = (await readAgent(logDir, 'codex', tidy)).cwd
    const claudeCwd = (await readAgent(logDir, 'claude', tidy)).cwd
    expect(codexCwd).not.toBe(sideA)

    await page.getByRole('button', { name: 'Keep B', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: /^Close A: / }).click()
    const clean = page.getByRole('alertdialog')
    await expect(clean.getByRole('heading')).toHaveText('Remove the worktree of A?')
    await expect(clean).toContainText('has no uncommitted files')
    await clean.getByRole('button', { name: /^Remove compare\// }).click()
    await expect.poll(() => existsSync(codexCwd), { timeout: SLOW }).toBe(false)
    await expect(page.locator('.toast').last()).toContainText('Removed compare/')
    expect(existsSync(claudeCwd)).toBe(true)
    expect(git(repo, 'branch', '--list', 'compare/*').split('\n').filter(Boolean)).toHaveLength(3)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('works in a folder that is not a git repository and reports why worktrees are off', async () => {
  const sandbox = createSandbox()
  const plain = join(mkdtempSync(join(tmpdir(), 'dawsha-plain-')), 'docs-site')
  mkdirSync(plain, { recursive: true })
  const fresh = makeRepo(sandbox.root, 'mobile-shell', false)
  seedProjects(sandbox, [
    { id: 'docs', name: 'docs-site', folder: plain },
    { id: 'mobile', name: 'mobile-shell', folder: fresh }
  ])
  const logDir = join(sandbox.root, 'agent-log')
  const { app, page } = await launchApp(sandbox, fakeEnv(logDir))
  try {
    const dialog = await openDialog(page)
    const worktrees = dialog.getByLabel("Start each in its own git worktree so their edits don't collide")
    await expect(dialog.locator('.compare-note')).toHaveText('This folder is not a git repository, so both agents work in the same folder.')
    await expect(worktrees).toBeDisabled()
    await expect(worktrees).not.toBeChecked()
    await dialog.getByLabel('Project').selectOption('mobile')
    await expect(dialog.locator('.compare-note')).toHaveText('This repository has no commits yet, so worktrees cannot start from HEAD.')
    await dialog.getByLabel('Project').selectOption('docs')
    await dialog.getByLabel('Prompt').fill('Draft the release notes')
    await dialog.getByRole('button', { name: 'Ask both' }).click()
    await expect(dialog).toHaveCount(0)
    expect((await readAgent(logDir, 'claude')).cwd).toBe(plain)
    expect((await readAgent(logDir, 'codex')).cwd).toBe(plain)
    await expect(page.getByRole('button', { name: 'Diff A vs B' })).toBeDisabled()

    await page.getByRole('button', { name: 'Keep A', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: /^Close B: / }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.compare-group')).toHaveCount(0)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
