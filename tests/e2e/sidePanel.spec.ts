import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, QUIT_BUDGET_MS, type Sandbox } from './helpers'

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

async function openPanes(page: Page, count: number): Promise<void> {
  const existing = await page.locator('.pane').count()
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Control+n')
    const picker = page.locator('.quickpick:not(.leaving)')
    await expect(picker.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
    await expect(picker.locator('input')).toBeFocused()
    await expect(picker.locator('.nd-start')).toBeEnabled()
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(existing + index + 1, { timeout: 20_000 })
  }
}

test('Side panel shows one session with a tab strip and a panel, remembers its width and tab, and goes back to the grid', async () => {
  const sandbox = createSandbox()
  const first = await launchApp(sandbox)
  let width = 0
  try {
    const { page } = first
    await openPanes(page, 2)
    await page.locator('#layout-panel').click()
    await expect(page.locator('#layout-panel')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.pane:visible')).toHaveCount(1)
    await expect(page.locator('.pane-strip .strip-tab')).toHaveCount(2)
    const panel = page.locator('.side-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('tab')).toHaveText([/^Changes/, /^Plan/, /^Checks/])
    await expect(panel.getByText('No changes yet.')).toBeVisible()
    await panel.getByRole('tab', { name: /^Plan/ }).click()
    await expect(panel.getByText('No plan yet.')).toBeVisible()
    await panel.getByRole('tab', { name: /^Checks/ }).click()
    await expect(panel.getByText('No checks ran after the last reply.')).toBeVisible()

    const handle = page.getByRole('separator', { name: 'Resize session panel' })
    // Shrink first: on a 1024px window the default width is already the most the session leaves room for.
    await handle.focus()
    await page.keyboard.press('Home')
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeLessThanOrEqual(281)
    const narrowest = (await panel.boundingBox())!.width
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(narrowest + 15)
    width = Math.round((await panel.boundingBox())!.width)
    await expect.poll(() => readSettings(sandbox.userData).sidePanel?.width).toBeGreaterThan(285)
    await expect.poll(() => readSettings(sandbox.userData).sidePanel?.tab).toBe('checks')
    await expect.poll(() => readSettings(sandbox.userData).sessionsLayout).toBe('panel')

    // Close and reopen the panel.
    await panel.getByRole('button', { name: 'Close the session panel' }).click()
    await expect(panel.getByRole('tab')).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox.userData).sidePanel?.open).toBe(false)
    await panel.getByRole('button', { name: 'Show the session panel' }).click()
    await expect(panel.getByRole('tab')).toHaveCount(3)
  } finally {
    expect(await closeApp(first.app)).toBeLessThan(QUIT_BUDGET_MS)
  }

  const second = await launchApp(sandbox)
  try {
    const { page } = second
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })
    await expect(page.locator('#layout-panel')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.pane:visible')).toHaveCount(1)
    const panel = page.locator('.side-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('tab', { name: /^Checks/ })).toHaveAttribute('aria-selected', 'true')
    await expect.poll(async () => Math.abs((await panel.boundingBox())!.width - width)).toBeLessThan(4)

    // Narrow windows (CI is 1024px) hide the panel's Back to grid link; the Grid switch is always there.
    const back = panel.getByRole('button', { name: 'Back to grid' })
    if (await back.isVisible()) await back.click()
    else await page.locator('#layout-grid').click()
    await expect(page.locator('#layout-grid')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.side-panel')).toBeHidden()
    await expect(page.locator('.pane:visible')).toHaveCount(2)
    await expect.poll(() => readSettings(sandbox.userData).sessionsLayout).toBe('grid')
  } finally {
    expect(await closeApp(second.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('a restart brings back the maximized pane, the active tab and the Chat view', async () => {
  const sandbox = createSandbox()
  const first = await launchApp(sandbox)
  try {
    const { page } = first
    await openPanes(page, 2)
    const second = page.locator('.pane').nth(1)
    await second.locator('.maximize').click()
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    await second.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(second.locator('.chat')).toBeVisible()
    await expect.poll(() => readSettings(sandbox.userData).workspace?.maximizedIndex).toBe(1)
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.[1]?.tabs?.[0]?.view).toBe('chat')
  } finally {
    expect(await closeApp(first.app)).toBeLessThan(QUIT_BUDGET_MS)
  }

  const next = await launchApp(sandbox)
  try {
    const { page } = next
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })
    const maximized = page.locator('.pane.maximized')
    await expect(maximized).toHaveCount(1)
    await expect(maximized).toContainText('2')
    await expect(maximized.locator('.chat')).toBeVisible()
    await expect(page.locator('.pane-strip .strip-tab.selected')).toHaveAttribute('data-pane-id', (await maximized.getAttribute('data-pane-id')) ?? '')
  } finally {
    expect(await closeApp(next.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

const AGENT = resolve(__dirname, '../support/chatAgent.cjs')
const SESSION = '7a1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'
const line = (record: unknown): string => JSON.stringify(record) + '\n'
const logPath = (sandbox: Sandbox): string => join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'), `${SESSION}.jsonl`)

function git(folder: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd: folder, encoding: 'utf8' })
}

function makeRepo(sandbox: Sandbox): void {
  const root = sandbox.projectFolder
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.ts'), 'const trimmed = input.trim()\nreturn new Date(trimmed)\n}\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }))
  git(root, 'init', '-q', '-b', 'fix/date-parsing')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'base')
  git(root, 'update-ref', `refs/dawsha/checkpoints/${SESSION}/${createHash('sha1').update('u1').digest('hex').slice(0, 16)}`, 'HEAD')
  writeFileSync(join(root, 'src', 'a.ts'), 'const trimmed = input.trim()\nconst hasZone = /z$/i.test(trimmed)\nreturn new Date(hasZone ? trimmed : `${trimmed}Z`)\n}\n')
  writeFileSync(join(root, 'created.ts'), 'export const created = true\n')
}

const iso = (): string => new Date().toISOString()

test('the Changes tab lists the files the last reply changed and the Plan tab shows the to-do list', async () => {
  const sandbox = createSandbox()
  makeRepo(sandbox)
  mkdirSync(join(logPath(sandbox), '..'), { recursive: true })
  const todos = [
    { content: 'Read the parser', status: 'completed', activeForm: 'Reading the parser' },
    { content: 'Handle zones', status: 'in_progress', activeForm: 'Handling zones' },
    { content: 'Run the tests', status: 'pending', activeForm: 'Running the tests' }
  ]
  writeFileSync(
    logPath(sandbox),
    [
      { type: 'user', uuid: 'u1', timestamp: iso(), message: { role: 'user', content: 'Fix date parsing' } },
      { type: 'assistant', uuid: 'p1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tt', name: 'TodoWrite', input: { todos } }] } },
      { type: 'user', uuid: 'pr', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tt', content: 'ok' }] } },
      { type: 'assistant', uuid: 'e1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'return new Date(trimmed)', new_string: 'const hasZone = /z$/i.test(trimmed)\nreturn new Date(hasZone ? trimmed : `${trimmed}Z`)' } }] } },
      { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
      { type: 'assistant', uuid: 'e2', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Write', input: { file_path: 'created.ts', content: 'export const created = true\n' } }] } },
      { type: 'user', uuid: 'r2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } },
      { type: 'assistant', uuid: 'a1', timestamp: iso(), message: { role: 'assistant', content: [{ type: 'text', text: 'Dates without a time zone are now read as UTC.' }] } }
    ].map(line).join('')
  )
  const env = { CHAT_LOG: logPath(sandbox), DAWSHA_CLAUDE_COMMAND: process.execPath, DAWSHA_CLAUDE_ARGS: JSON.stringify([AGENT, 'claude']) }
  const { app, page } = await launchApp(sandbox, env)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    const now = Date.now()
    writeFileSync(join(sandbox.sessionsDir, `${SESSION}.json`), JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, name: 'Fix date parsing', nameSource: 'user', status: 'idle', startedAt: now + 1000, updatedAt: now + 1000 }), 'utf8')
    const pane = page.locator('.pane').first()
    await pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(pane.locator('.chat-turn-summary')).toBeVisible({ timeout: 20_000 })

    await page.locator('#layout-panel').click()
    const panel = page.locator('.side-panel')
    await expect(panel.locator('.chat-turn-summary')).toBeVisible({ timeout: 20_000 })
    await expect(panel.locator('.chat-turn-file')).toHaveCount(2)
    await expect(panel.locator('.chat-turn-file', { hasText: 'a.ts' })).toBeVisible()
    await expect(panel.locator('.chat-turn-file', { hasText: 'created.ts' })).toBeVisible()
    await expect(panel.getByRole('tab', { name: /^Changes/ })).toContainText('2')
    await expect(panel.getByRole('button', { name: /Undo this reply/ })).toBeVisible({ timeout: 20_000 })
    await expect(panel.getByRole('button', { name: 'Review changes' })).toBeVisible()
    await panel.locator('.chat-turn-file', { hasText: 'a.ts' }).click()
    await expect(panel.locator('.turn-diff').first()).toBeVisible()

    await expect(panel.getByRole('tab', { name: /^Plan/ })).toContainText('1/3')
    await panel.getByRole('tab', { name: /^Plan/ }).click()
    await expect(panel.locator('.chat-todos .todo')).toHaveCount(3)
    await expect(panel.locator('.chat-todos .todo.in_progress')).toContainText('Handle zones')

    // The same plan reaches the sidebar row and the open tab.
    await expect(page.locator('.sess-row .sess-plan-n').first()).toHaveText('1/3')
    await expect(page.locator('.pane-strip .strip-tab.selected .strip-plan')).toHaveText('1/3')
    await expect(page.locator('.pane-strip .strip-tab.selected .strip-bar i')).toHaveAttribute('style', /width: 33%/)
  } finally {
    await closeApp(app)
  }
})
