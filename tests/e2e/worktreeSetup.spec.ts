import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { activeTermId, bufferText, closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const AGENT = { DAWSHA_CLAUDE_COMMAND: process.execPath, DAWSHA_CLAUDE_ARGS: JSON.stringify([resolve(__dirname, '../support/fakeAgent.cjs'), 'claude']) }

function repoWith(sandbox: Sandbox, setup: string): void {
  const run = (...args: string[]): void => { execFileSync('git', args, { cwd: sandbox.projectFolder }) }
  run('init', '-q')
  writeFileSync(join(sandbox.projectFolder, '.gitignore'), '.env\nsecret.pem\n')
  writeFileSync(join(sandbox.projectFolder, '.env'), 'LOCAL=1')
  writeFileSync(join(sandbox.projectFolder, 'secret.pem'), 'private')
  writeFileSync(join(sandbox.projectFolder, '.worktreeinclude'), '.env\n')
  writeFileSync(join(sandbox.projectFolder, 'README.md'), 'hi')
  run('add', '.gitignore', 'README.md', '.worktreeinclude')
  run('-c', 'user.name=T', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'init')
  const file = join(sandbox.userData, 'settings.json')
  const settings = JSON.parse(readFileSync(file, 'utf8'))
  settings.projects[0].worktreeSetup = { command: setup, prompted: true }
  writeFileSync(file, JSON.stringify(settings))
}

const worktreeOf = (sandbox: Sandbox): string => {
  const name = readdirSync(sandbox.root).find((entry) => entry.startsWith('Smoke Project-preset-'))
  if (!name) throw new Error('No worktree was made.')
  return join(sandbox.root, name)
}

async function startInOwnWorktree(page: Page): Promise<string> {
  await page.locator('#new-session').click()
  await page.getByRole('checkbox', { name: 'Use its own worktree', exact: true }).check()
  await page.getByRole('button', { name: 'Start Claude in Smoke', exact: true }).click()
  await expect.poll(() => page.locator('.term-host.active').count()).toBeGreaterThan(0)
  return activeTermId(page)
}

test('a new worktree gets its local files and finishes setup before the agent starts', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  repoWith(sandbox, 'echo ran> setup.flag')
  const { app, page } = await launchApp(sandbox, AGENT)
  try {
    const id = await startInOwnWorktree(page)
    await expect.poll(() => bufferText(page, id)).toContain('READY claude')
    const worktree = worktreeOf(sandbox)
    expect(readFileSync(join(worktree, '.env'), 'utf8')).toBe('LOCAL=1')
    expect(existsSync(join(worktree, 'secret.pem'))).toBe(false)
    expect(existsSync(join(worktree, 'setup.flag'))).toBe(true)
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).pendingWorktreeSetups?.length ?? 0).toBe(0)
  } finally {
    await closeApp(app)
  }
})

test('a failed setup offers Retry and Start the agent anyway', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  repoWith(sandbox, 'if not exist ok.flag exit /b 3')
  const { app, page } = await launchApp(sandbox, AGENT)
  try {
    const id = await startInOwnWorktree(page)
    const choice = page.getByRole('group', { name: 'Worktree setup failed' })
    await expect(choice).toContainText('Setup failed (exit 3).')
    expect(await bufferText(page, id)).not.toContain('READY claude')
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).pendingWorktreeSetups?.length ?? 0).toBe(1)

    await choice.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(choice).toBeVisible()
    writeFileSync(join(worktreeOf(sandbox), 'ok.flag'), '')
    await choice.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect.poll(() => bufferText(page, id)).toContain('READY claude')
    await expect(choice).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('Start the agent anyway skips a failed setup and keeps the worktree', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  repoWith(sandbox, 'exit /b 5')
  const { app, page } = await launchApp(sandbox, AGENT)
  try {
    const id = await startInOwnWorktree(page)
    const choice = page.getByRole('group', { name: 'Worktree setup failed' })
    await expect(choice).toContainText('Setup failed (exit 5).')
    await choice.getByRole('button', { name: 'Start the agent anyway', exact: true }).click()
    await expect.poll(() => bufferText(page, id)).toContain('READY claude')
    expect(existsSync(join(worktreeOf(sandbox), '.env'))).toBe(true)
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).pendingWorktreeSetups?.length ?? 0).toBe(0)
  } finally {
    await closeApp(app)
  }
})
