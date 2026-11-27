import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const FIRST = '33333333-4444-4555-8666-777777777771'
const SECOND = '33333333-4444-4555-8666-777777777772'

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, stdio: 'ignore' })
}

function transcript(sandbox: Sandbox, id: string, title: string, file: string, minutesAgo: number): void {
  const dir = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const at = (offset: number): string => new Date(Date.now() - (minutesAgo - offset) * 60_000).toISOString()
  const records = [
    { type: 'user', timestamp: at(0), message: { content: `Work on ${title}` } },
    { type: 'assistant', timestamp: at(1), message: { content: [{ type: 'tool_use', id: `e-${id}`, name: 'Edit', input: { file_path: join(sandbox.projectFolder, file), old_string: 'one', new_string: 'two' } }] } },
    { type: 'user', timestamp: at(2), message: { content: [{ type: 'tool_result', tool_use_id: `e-${id}`, content: 'ok' }] } },
    { type: 'ai-title', aiTitle: title }
  ]
  writeFileSync(join(dir, `${id}.jsonl`), records.map((record) => JSON.stringify(record)).join('\n') + '\n')
}

async function resume(page: Page, title: string): Promise<void> {
  await page.keyboard.press('Control+Shift+R')
  await page.locator('.rp-row', { hasText: title }).click()
}

test('two sessions in the same checkout editing one file each get a line under the terminal, and Review marks the file', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox()
  mkdirSync(join(sandbox.projectFolder, 'src'), { recursive: true })
  writeFileSync(join(sandbox.projectFolder, 'src', 'sessionTabs.ts'), 'one\n')
  git(sandbox.projectFolder, 'init', '-q', '-b', 'main')
  git(sandbox.projectFolder, 'add', '.')
  git(sandbox.projectFolder, 'commit', '-q', '-m', 'first')
  writeFileSync(join(sandbox.projectFolder, 'src', 'sessionTabs.ts'), 'two\n')
  transcript(sandbox, FIRST, 'Taskbar customization', 'src/sessionTabs.ts', 8)
  transcript(sandbox, SECOND, 'New feature ideas', 'src/sessionTabs.ts', 3)
  const { app, page } = await launchApp(sandbox)
  try {
    await resume(page, 'Taskbar customization')
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    await resume(page, 'New feature ideas')
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })

    const notices = page.locator('.overlap-notice:not([hidden])')
    await expect(notices).toHaveCount(2, { timeout: 40_000 })
    await expect(notices.first()).toContainText('Also being edited')
    await expect(notices.first()).toContainText('sessionTabs.ts changed')
    await expect(notices.first()).toContainText('in the same checkout')

    // The line floats over the terminal: it never changes the terminal's height.
    const body = page.locator('.pane').first().locator('.pane-body')
    const before = (await body.boundingBox())?.height ?? 0
    await notices.first().getByRole('button', { name: /^Dismiss/ }).click()
    await expect(notices).toHaveCount(1)
    expect((await body.boundingBox())?.height ?? 0).toBe(before)

    await notices.first().getByRole('button', { name: 'Compare' }).click()
    await expect(page.locator('#files-view')).toBeVisible()
    await expect(page.locator('.files-review-row[data-path="src/sessionTabs.ts"] .files-review-overlap')).toHaveText('Also edited')
  } finally {
    await closeApp(app)
  }
})

test('Tell sends the re-read message to the session and clears its line', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox()
  mkdirSync(join(sandbox.projectFolder, 'src'), { recursive: true })
  writeFileSync(join(sandbox.projectFolder, 'src', 'sessionTabs.ts'), 'one\n')
  transcript(sandbox, FIRST, 'Taskbar customization', 'src/sessionTabs.ts', 8)
  transcript(sandbox, SECOND, 'New feature ideas', 'src/sessionTabs.ts', 3)
  const { app, page } = await launchApp(sandbox)
  try {
    await resume(page, 'Taskbar customization')
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    await resume(page, 'New feature ideas')
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })
    const notices = page.locator('.overlap-notice:not([hidden])')
    await expect(notices).toHaveCount(2, { timeout: 40_000 })
    const first = page.locator('.pane').first()
    await first.locator('.overlap-notice').getByRole('button', { name: /^Tell/ }).click()
    await expect(first.locator('.overlap-notice')).toBeHidden()
    await expect(notices).toHaveCount(1)
  } finally {
    await closeApp(app)
  }
})
