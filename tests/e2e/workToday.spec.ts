import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openMore } from './helpers'

const id = (n: number) => `11111111-2222-4333-8444-${String(n).padStart(12, '0')}`
const lines = (...records: unknown[]) => records.map((r) => JSON.stringify(r)).join('\n') + '\n'

test('the Today card lists a session that worked today with its files, and copies a plain recap', async () => {
  const sandbox = createSandbox()
  const end = new Date(Date.now() - 1000).toISOString()
  const start = new Date(Date.now() - 61_000).toISOString()
  const dir = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id(1)}.jsonl`), lines(
    { type: 'user', timestamp: start, gitBranch: 'fix/18550', message: { content: 'Fix the restore bug' } },
    { type: 'assistant', timestamp: end, gitBranch: 'fix/18550', message: { content: [{ type: 'text', text: 'Done' }] } },
    { type: 'ai-title', aiTitle: 'Fixed the restore bug' }
  ))
  const at = new Date(Date.now() - 30_000).toISOString()
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], {
    cwd: sandbox.projectFolder, windowsHide: true, env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at }
  })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.invalid')
  git('checkout', '-q', '-b', 'fix/18550')
  writeFileSync(join(sandbox.projectFolder, 'restore.ts'), 'export const restore = 1\n')
  writeFileSync(join(sandbox.projectFolder, 'notes.md'), 'restore\n')
  git('add', '.')
  git('commit', '-qm', 'fix: restore')

  const { app, page } = await launchApp(sandbox)
  try {
    await openMore(page, 'work')
    const card = page.locator('#work-today')
    await expect(card).toBeVisible()
    await expect(card.locator('.today-row')).toHaveCount(1)
    const row = card.locator('.today-row')
    await expect(row).toContainText('Fixed the restore bug')
    await expect(row).toContainText('Smoke')
    await expect(row).toContainText('1m')
    await expect(row.locator('.today-changes')).toContainText('2 files')
    await expect(row.locator('.agent-mark')).toBeVisible()
    await expect(page.locator('#work-today-total')).toContainText('2 files')

    await card.getByRole('button', { name: 'Copy as text' }).click()
    await expect(page.locator('.toasts')).toContainText('Copied')
    // The system clipboard round-trips on CI; a local desktop session may block it.
    if (process.env.CI) {
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Today: Fixed the restore bug in Smoke (1m, 2 files). Total 1m, 2 files.')
    }
  } finally {
    await closeApp(app)
  }
})

test('the Today card says so when nothing happened today', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openMore(page, 'work')
    const card = page.locator('#work-today')
    await expect(card).toContainText('Nothing yet today.')
    await expect(card.getByRole('button', { name: 'Copy as text' })).toBeDisabled()
  } finally {
    await closeApp(app)
  }
})
