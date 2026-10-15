import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, QUIT_BUDGET_MS, type Sandbox } from './helpers'

const SESSION_ID = '22222222-3333-4444-8555-666666666666'

function git(folder: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: folder, stdio: 'ignore' })
}

const stamp = (minute: number): string => new Date(Date.UTC(2026, 9, 8, 9, minute, 0)).toISOString()

function seed(sandbox: Sandbox): void {
  const dir = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const file = join(sandbox.projectFolder, 'a.txt')
  const records = [
    { type: 'user', timestamp: stamp(0), message: { content: 'Add retry to the webhook sender' } },
    {
      type: 'assistant',
      timestamp: stamp(2),
      message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: file, old_string: 'one', new_string: 'one\ntwo' } }] }
    },
    { type: 'user', timestamp: stamp(3), message: { content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'ok' }] } },
    {
      type: 'assistant',
      timestamp: stamp(5),
      message: { content: [{ type: 'tool_use', id: 'e2', name: 'Edit', input: { file_path: join(sandbox.projectFolder, 'sender.ts'), old_string: 'a', new_string: 'b' } }] }
    },
    { type: 'user', timestamp: stamp(6), message: { content: [{ type: 'tool_result', tool_use_id: 'e2', content: 'ok' }] } },
    { type: 'assistant', timestamp: stamp(8), message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } },
    {
      type: 'user',
      timestamp: stamp(9),
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Tests  1 failed | 23 passed (24)' }] }
    },
    { type: 'assistant', timestamp: stamp(11), message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }] } },
    {
      type: 'user',
      timestamp: stamp(12),
      message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Tests  24 passed (24)' }] }
    },
    { type: 'user', timestamp: stamp(20), message: { content: 'Now also cap the backoff at 30 seconds' } },
    { type: 'ai-title', aiTitle: 'Add retry to the sender' }
  ]
  writeFileSync(join(dir, `${SESSION_ID}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  git(sandbox.projectFolder, 'init', '-q')
  writeFileSync(file, 'one\n', 'utf8')
  writeFileSync(join(sandbox.projectFolder, '0-first.txt'), 'x\n', 'utf8')
  git(sandbox.projectFolder, 'add', '.')
  git(sandbox.projectFolder, 'commit', '-q', '-m', 'init')
  writeFileSync(file, 'one\ntwo\n', 'utf8')
  writeFileSync(join(sandbox.projectFolder, '0-first.txt'), 'y\n', 'utf8')
}

async function resumeSeeded(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+R')
  await expect(page.locator('.rp-row')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
}

test('the timeline lists the session, filters it, searches it and shows insights', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  const out = join(sandbox.root, 'timeline.md')
  const { app, page } = await launchApp(sandbox, { DAWSHA_SAVE_PATH: out })
  try {
    await resumeSeeded(page)
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Show session timeline' }).click()
    const panel = page.getByRole('complementary', { name: 'Timeline' })
    await expect(panel).toBeVisible()
    await expect(panel.locator('.tl-summary')).toContainText('2 prompts', { timeout: 20_000 })
    await expect(panel.locator('.tl-event.tl-prompt')).toHaveCount(2)
    await expect(panel.locator('.tl-event.tl-prompt').first()).toContainText('Add retry to the webhook sender')
    await expect(panel.locator('.tl-time').first()).toHaveText(/^\d\d:\d\d$/)

    await panel.getByRole('button', { name: 'Edits' }).click()
    await expect(panel.locator('.tl-event')).toHaveCount(2)
    await panel.getByRole('button', { name: 'Tests' }).click()
    await expect(panel.locator('.tl-event')).toHaveCount(2)
    await expect(panel.locator('.tl-event').first()).toContainText('23 passed · 1 failed')
    await expect(panel.locator('.tl-event').last()).toContainText('24 passed')
    await panel.getByRole('button', { name: 'All', exact: true }).click()

    const search = panel.getByRole('searchbox', { name: 'Search the timeline' })
    await search.fill('npm test')
    await expect(panel.locator('.tl-count')).toHaveText('1 of 2')
    await expect(panel.locator('mark.tl-hit').first()).toHaveText('npm test')
    await search.press('Enter')
    await expect(panel.locator('.tl-count')).toHaveText('2 of 2')
    await search.press('Shift+Enter')
    await expect(panel.locator('.tl-count')).toHaveText('1 of 2')
    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(panel.locator('.tl-count')).toHaveText('')
    await expect(panel).toBeVisible()

    const insights = panel.getByRole('region', { name: 'Insights' })
    await expect(insights).toContainText('Files touched most')
    await expect(insights).toContainText('a.txt')
    await expect(insights).toContainText('Commands run')
    await expect(insights).toContainText('Test runs (2)')
    await panel.getByRole('button', { name: 'Insights' }).click()
    await expect(insights.locator('.tl-insights-body')).toBeHidden()
    await panel.getByRole('button', { name: 'Insights' }).click()
    await expect(insights.locator('.tl-insights-body')).toBeVisible()

    await panel.getByRole('button', { name: 'Export as Markdown' }).click()
    await expect(page.locator('.toast')).toContainText('Timeline saved to', { timeout: 20_000 })
    const text = readFileSync(out, 'utf8')
    expect(text).toContain('# Timeline: ')
    expect(text).toContain('**You:** Add retry to the webhook sender')
    expect(text).toContain('Tests `npm test`: 23 passed · 1 failed')
    expect(text).toContain('Test runs: 2 (fail, pass)')

    await panel.getByRole('button', { name: /Edited .*a\.txt/ }).click()
    const dialog = page.getByRole('dialog', { name: /Changes in/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.changes-row')).toHaveCount(2)
    await expect(dialog.locator('.changes-file-head').first()).toHaveText(/a\.txt/)
    await expect(dialog.locator('.changes-file-head').first()).not.toHaveText(/0-first/)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('Ctrl+Shift+T and the palette toggle the timeline, and Escape closes it', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await resumeSeeded(page)
    const panel = page.getByRole('complementary', { name: 'Timeline' })
    await page.keyboard.press('Control+Shift+T')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('searchbox', { name: 'Search the timeline' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await page.keyboard.press('Control+Shift+P')
    await page.keyboard.type('Show session timeline')
    await page.keyboard.press('Enter')
    await expect(panel).toBeVisible()
    await page.getByRole('button', { name: 'Close timeline' }).click()
    await expect(panel).toBeHidden()
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('new log lines appear while the timeline is open, and a half-written line waits for its end', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  const log = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'), `${SESSION_ID}.jsonl`)
  const { app, page } = await launchApp(sandbox)
  try {
    await resumeSeeded(page)
    await page.keyboard.press('Control+Shift+T')
    const panel = page.getByRole('complementary', { name: 'Timeline' })
    await expect(panel.locator('.tl-event.tl-prompt')).toHaveCount(2, { timeout: 20_000 })
    const line = JSON.stringify({ type: 'user', timestamp: stamp(30), message: { content: 'A prompt added later' } })
    appendFileSync(log, line.slice(0, 20))
    await page.waitForTimeout(5000)
    await expect(panel.locator('.tl-event.tl-prompt')).toHaveCount(2)
    appendFileSync(log, line.slice(20) + '\n')
    await expect(panel.locator('.tl-event.tl-prompt')).toHaveCount(3, { timeout: 15_000 })
    await expect(panel.locator('.tl-summary')).toContainText('3 prompts')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

const CLOSED_ID = '22222222-3333-4444-8555-777777777777'

function seedClosed(sandbox: Sandbox): void {
  const dir = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  const path = join(dir, `${CLOSED_ID}.jsonl`)
  const records = [
    { type: 'user', timestamp: stamp(0), message: { content: 'Why is the zebracache step slow?' } },
    { type: 'assistant', timestamp: stamp(2), message: { content: [{ type: 'text', text: 'The zebracache key is missing.' }] } },
    { type: 'assistant', timestamp: stamp(4), message: { content: [{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'echo zebracache' } }] } },
    {
      type: 'assistant',
      timestamp: stamp(6),
      message: { content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: join(sandbox.projectFolder, 'ci', 'zebracache.yml'), old_string: 'a', new_string: 'b' } }] }
    },
    { type: 'ai-title', aiTitle: 'Investigate slow CI' }
  ]
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  const old = new Date(Date.now() - 4 * 24 * 60 * 60_000)
  utimesSync(path, old, old)
}

test('searching all sessions finds a closed session, opens it read-only at the match and resumes it', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  seedClosed(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.keyboard.press('Control+Shift+R')
    await expect(page.locator('.rp-row')).toHaveCount(2)
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })

    await page.keyboard.press('Control+Alt+F')
    const panel = page.getByRole('complementary', { name: 'Timeline' })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: 'All sessions' })).toHaveAttribute('aria-pressed', 'true')
    const search = panel.getByRole('searchbox', { name: 'Search all sessions' })
    await expect(search).toBeFocused()
    await search.fill('zebracache')

    const group = panel.getByRole('region', { name: 'Investigate slow CI' })
    await expect(group).toBeVisible({ timeout: 20_000 })
    await expect(panel.locator('.tl-result')).toHaveCount(1)
    await expect(group.locator('.tl-result-hit')).toHaveCount(3)
    await expect(group).toContainText('1 more in this session')
    await expect(group.locator('mark.tl-hit').first()).toHaveText('zebracache')
    await expect(group).toContainText('Claude')

    await panel.getByRole('button', { name: 'Edits' }).click()
    await expect(group.locator('.tl-result-hit')).toHaveCount(1, { timeout: 20_000 })
    await expect(group).not.toContainText('more in this session')
    await panel.getByRole('button', { name: 'All', exact: true }).click()
    await expect(group.locator('.tl-result-hit')).toHaveCount(3, { timeout: 20_000 })

    await group.locator('.tl-result-hit').nth(1).click()
    await expect(panel.locator('.tl-past')).toContainText('Past session: Investigate slow CI')
    await expect(panel.locator('.tl-event.current')).toContainText('The zebracache key is missing.', { timeout: 20_000 })
    await expect(panel.locator('.tl-event.tl-prompt')).toContainText('Why is the zebracache step slow?')
    await expect(panel.locator('.tl-state')).toHaveCount(0)

    await panel.getByRole('button', { name: 'Back to results' }).click()
    await expect(group).toBeVisible()
    await group.getByRole('button', { name: 'Open Investigate slow CI' }).click()
    await panel.getByRole('button', { name: 'Resume session' }).click()
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
