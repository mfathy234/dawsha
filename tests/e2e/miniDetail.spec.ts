import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { activeTermId, bufferText, closeApp, createSandbox, feedTerminal, launchApp, type Sandbox } from './helpers'

const AGENT = resolve(__dirname, '../support/chatAgent.cjs')
const SESSION = '6b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e1'
const line = (record: unknown): string => JSON.stringify(record) + '\n'
const logPath = (sandbox: Sandbox): string => join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'), `${SESSION}.jsonl`)
const agentEnv = (sandbox: Sandbox): Record<string, string> => ({ CHAT_LOG: logPath(sandbox), DAWSHA_CLAUDE_COMMAND: process.execPath, DAWSHA_CLAUDE_ARGS: JSON.stringify([AGENT, 'claude']) })

async function openMini(app: ElectronApplication, page: Page): Promise<Page> {
  const opened = app.waitForEvent('window')
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mini window' }).click()
  const mini = await opened
  await expect(mini.locator('#mini')).toBeVisible()
  return mini
}

function writeSession(sandbox: Sandbox, status: 'busy' | 'idle'): void {
  const now = Date.now()
  writeFileSync(join(sandbox.sessionsDir, `${SESSION}.json`), JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, name: 'Billing refactor', nameSource: 'user', status, startedAt: now - 5000, updatedAt: now }), 'utf8')
}

function writeTalk(sandbox: Sandbox): void {
  mkdirSync(join(logPath(sandbox), '..'), { recursive: true })
  writeFileSync(logPath(sandbox), [
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'Move invoice totals' } },
    { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'Moved invoice totals into billing/totals.ts.\n\nAll tests pass.' }] } }
  ].map(line).join(''))
}

function makeChanges(sandbox: Sandbox): void {
  const root = sandbox.projectFolder
  const git = (...args: string[]): void => { execFileSync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8' }) }
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.ts'), 'const a = 1\n')
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-q', '-m', 'base')
  writeFileSync(join(root, 'src', 'a.ts'), 'const a = 2\nconst b = 3\n')
  writeFileSync(join(root, 'created.ts'), 'export const created = true\n')
}

function writeContext(sandbox: Sandbox, percent: number): void {
  mkdirSync(sandbox.opsDir, { recursive: true })
  const snapshot = { v: 1, sessionId: SESSION, cwd: sandbox.projectFolder, updatedAt: Date.now(), ended: false, model: 'claude-opus-5-5', agents: [], context: { percent, tokens: 82_000, window: 200_000, stage: 'fine' }, compactions: 0, limits: [], files: [], checks: [] }
  writeFileSync(join(sandbox.opsDir, `${SESSION}.json`), JSON.stringify(snapshot), 'utf8')
}

test('the detail shows what you asked, the last reply, the changes and usage, and replying from Mini reaches the session', async () => {
  const sandbox = createSandbox()
  makeChanges(sandbox)
  writeTalk(sandbox)
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    writeSession(sandbox, 'idle')
    writeContext(sandbox, 41)
    const termId = await activeTermId(page)
    const mini = await openMini(app, page)
    await mini.locator('.mini-card .mini-select').click()
    const detail = mini.locator('.mini-detail')
    await expect(detail.locator('.mini-now')).toContainText('Idle')
    await expect(detail.locator('.mini-asked')).toHaveText('Move invoice totals', { timeout: 15_000 })
    await expect(detail.locator('.mini-reply')).toContainText('Moved invoice totals into billing/totals.ts.')
    await expect(detail.locator('.mini-reply')).toContainText('All tests pass.')
    await expect(detail.locator('.mini-changes')).toContainText('1 file +2 -1', { timeout: 15_000 })
    await expect(detail.locator('.mini-usage')).toContainText('Context 41%', { timeout: 15_000 })

    const box = detail.getByRole('textbox', { name: 'Message this session' })
    await box.focus()
    await mini.keyboard.type('first')
    await mini.keyboard.press('Shift+Enter')
    await mini.keyboard.type('second')
    expect(await box.inputValue()).toBe('first\nsecond')
    await box.fill('')
    await mini.keyboard.type('run the tests')
    await mini.keyboard.press('Enter')
    await expect(detail.locator('.mini-compose-note')).toHaveText('Sent')
    expect(await box.inputValue()).toBe('')
    await expect.poll(() => bufferText(page, termId), { timeout: 15_000 }).toContain('GOT "run the tests"')
    await expect(detail.locator('.mini-asked')).toHaveText('run the tests', { timeout: 15_000 })
    await expect(detail.locator('.mini-reply')).toContainText('Echo: run the tests', { timeout: 15_000 })

    await detail.getByRole('button', { name: 'Review', exact: true }).click()
    await expect(page.locator('.files-view')).toBeVisible({ timeout: 15_000 })
  } finally { await closeApp(app) }
})

test('the reply box is disabled with a reason while the session waits for an answer, and keeps what was typed', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: /^New (Claude|Codex|Gemini) session in Smoke$/ }).click()
    const id = await activeTermId(page)
    await expect.poll(async () => (await bufferText(page, id)).replace(/\n/g, '').trimEnd(), { timeout: 30_000 }).toMatch(/[>$#%]$/)
    const mini = await openMini(app, page)
    await mini.locator('.mini-card .mini-select').click()
    const box = mini.getByRole('textbox', { name: 'Message this session' })
    await box.focus()
    await mini.keyboard.type('draft text')
    await expect(async () => {
      await feedTerminal(page, id, ['● Bash(npm run migrate)', 'Do you want to proceed?', '1. Yes', '3. No', ''].join('\r\n'))
      await expect(mini.locator('.mini-detail')).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
    }).toPass({ timeout: 15_000 })
    await expect(mini.locator('.mini-now')).toContainText('Waiting for you: Run npm run migrate?')
    await expect(box).toBeDisabled()
    await expect(mini.locator('.mini-compose-note')).toHaveText('Answer the request above first.')
    await mini.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect(box).toBeEnabled({ timeout: 15_000 })
    expect(await box.inputValue()).toBe('draft text')
  } finally { await closeApp(app) }
})

test('a session that finishes shows Done with its file count and Review, and the working spinner stops under reduced motion', async () => {
  const sandbox = createSandbox()
  makeChanges(sandbox)
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    writeSession(sandbox, 'busy')
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(2)
    const mini = await openMini(app, page)
    const card = mini.locator('.mini-card[data-pane-id="' + (await page.locator('.pane').first().getAttribute('data-pane-id')) + '"]')
    await expect(card).toHaveAttribute('data-state', 'working', { timeout: 15_000 })
    await expect(card.locator('.mini-spin')).toBeVisible()
    await expect.poll(() => mini.evaluate(() => document.getAnimations().some(a => (a as CSSAnimation).animationName === 'mini-spin'))).toBe(true)
    await mini.emulateMedia({ reducedMotion: 'reduce' })
    await expect.poll(() => mini.evaluate(() => document.getAnimations().length)).toBe(0)
    await mini.emulateMedia({ reducedMotion: 'no-preference' })
    writeSession(sandbox, 'idle')
    await expect(card).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    await expect(card.locator('.mini-line')).toContainText(/^Done.*1 file/, { timeout: 15_000 })
    await expect(card.getByRole('button', { name: 'Review', exact: true })).toBeVisible()
  } finally { await closeApp(app) }
})
