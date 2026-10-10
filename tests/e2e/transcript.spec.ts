import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { activeTermId, bufferText, closeApp, createSandbox, feedTerminal, launchApp, QUIT_BUDGET_MS, type Sandbox } from './helpers'

const SESSION_ID = '11111111-2222-4333-8444-555555555555'
const NEW_CLAUDE = 'New Claude session in Smoke'

function git(folder: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: folder, stdio: 'ignore' })
}

function seed(sandbox: Sandbox): void {
  const dir = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const records = [
    { type: 'user', timestamp: '2026-10-08T09:12:00.000Z', message: { content: 'Add a dark mode toggle to the settings page' } },
    {
      type: 'assistant',
      timestamp: '2026-10-08T09:12:30.000Z',
      message: {
        model: 'claude-opus-5-5',
        content: [
          { type: 'text', text: 'The toggle now lives in Settings.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }
        ]
      }
    },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'SECRET-TOOL-OUTPUT' }] } },
    { type: 'ai-title', aiTitle: 'Add dark mode toggle' }
  ]
  writeFileSync(join(dir, `${SESSION_ID}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  git(sandbox.projectFolder, 'init', '-q')
  writeFileSync(join(sandbox.projectFolder, 'a.txt'), 'one\n', 'utf8')
  git(sandbox.projectFolder, 'add', '.')
  git(sandbox.projectFolder, 'commit', '-q', '-m', 'init')
  writeFileSync(join(sandbox.projectFolder, 'a.txt'), 'one\ntwo\n', 'utf8')
}

async function resumeSeeded(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+R')
  await expect(page.locator('.rp-row')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
}

test('the pane menu exports a session as Markdown with prompts, replies, tool lines and changes', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  const out = join(sandbox.root, 'export.md')
  const { app, page } = await launchApp(sandbox, { DAWSHA_SAVE_PATH: out })
  try {
    await resumeSeeded(page)
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Export transcript…' }).click()
    await expect(page.locator('.toast')).toContainText('Transcript saved to', { timeout: 20_000 })
    await expect(page.locator('.toast')).toContainText(out)
    const text = readFileSync(out, 'utf8')
    expect(text).toContain('# Add dark mode toggle')
    expect(text).toContain('**Agent:** Claude')
    expect(text).toContain('**Model:** claude-opus-5-5')
    expect(text).toContain('**Project:** Smoke')
    expect(text).toContain(`**Session:** ${SESSION_ID}`)
    expect(text).toContain('> Add a dark mode toggle to the settings page')
    expect(text).toContain('The toggle now lives in Settings.')
    expect(text).toContain('- **Bash** `npm test`')
    expect(text).not.toContain('SECRET-TOOL-OUTPUT')
    expect(text).not.toContain('Terminal text only')
    expect(text).toContain('## Changes')
    expect(text).toContain('a.txt')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('the palette exports a self-contained HTML page when the chosen file is .html', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  const out = join(sandbox.root, 'export.html')
  const { app, page } = await launchApp(sandbox, { DAWSHA_SAVE_PATH: out })
  try {
    await resumeSeeded(page)
    await page.locator('.term-host.active').click()
    await page.keyboard.press('Control+k')
    await page.locator('#palette-input').fill('export transcript')
    await expect(page.locator('.palette-row.selected')).toHaveAttribute('data-command', 'pane.transcript')
    await page.keyboard.press('Enter')
    await expect(page.locator('.toast')).toContainText('Transcript saved to', { timeout: 20_000 })
    const html = readFileSync(out, 'utf8')
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('prefers-color-scheme:dark')
    expect(html).toContain('Add a dark mode toggle to the settings page')
    expect(html).toContain('The toggle now lives in Settings.')
    expect(html).toContain('<b>Bash</b> npm test')
    expect(html).not.toMatch(/<script|<link|src="http/)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('a tab without a session file exports its terminal text and says so', async () => {
  const sandbox = createSandbox()
  const out = join(sandbox.root, 'terminal.md')
  const { app, page } = await launchApp(sandbox, { DAWSHA_SAVE_PATH: out })
  try {
    await page.getByRole('button', { name: NEW_CLAUDE, exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    const id = await activeTermId(page)
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toContain('Smoke Project>')
    await feedTerminal(page, id, 'build finished in 4s\r\n\u001b[32mall green\u001b[0m\r\n')
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toContain('all green')
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Export transcript…' }).click()
    await expect(page.locator('.toast')).toContainText('terminal text only', { timeout: 20_000 })
    expect(existsSync(out)).toBe(true)
    const text = readFileSync(out, 'utf8')
    expect(text).toContain('**Source:** Terminal text only')
    expect(text).toContain('## Terminal output')
    expect(text).toContain('build finished in 4s')
    expect(text).toContain('all green')
    expect(text).not.toContain('[32m')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
