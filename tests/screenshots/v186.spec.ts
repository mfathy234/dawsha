import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from '../e2e/helpers'

const SITE = process.env.DAWSHA_SHOTS_OUT ?? resolve(__dirname, '../../site/assets')
const AGENT = resolve(__dirname, '../support/chatAgent.cjs')
const SIZE = { width: 1168, height: 668 }
const line = (record: unknown): string => JSON.stringify(record) + '\n'
const iso = (offsetMs = 0): string => new Date(Date.now() + offsetMs).toISOString()

function agentEnv(log: string): Record<string, string> {
  const node = process.execPath
  return { CHAT_LOG: log, DAWSHA_CLAUDE_COMMAND: node, DAWSHA_CLAUDE_ARGS: JSON.stringify([AGENT, 'claude']) }
}

const logFor = (sandbox: Sandbox, session: string): string => join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'), `${session}.jsonl`)

function git(folder: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd: folder, encoding: 'utf8' })
}

function writeSession(sandbox: Sandbox, session: string, name: string, status: 'busy' | 'idle'): void {
  const now = Date.now()
  writeFileSync(join(sandbox.sessionsDir, `${session}.json`), JSON.stringify({ pid: process.pid, sessionId: session, cwd: sandbox.projectFolder, name, nameSource: 'user', status, startedAt: now + 1000, updatedAt: now + 1000 }), 'utf8')
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SITE, { recursive: true })
  // The sandbox adds a project whose folder is missing; keep it out of the picture.
  await page.evaluate(() => document.querySelectorAll('.proj-missing-line').forEach((line) => { (line.previousElementSibling as HTMLElement | null)?.setAttribute('hidden', ''); line.setAttribute('hidden', '') }))
  await page.screenshot({ path: join(SITE, `${name}.png`) })
}

async function openChat(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
  await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
  const pane = page.locator('.pane').first()
  await pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Chat', exact: true }).click()
  return pane
}

const edit = (id: string, file: string, from: string, to: string): unknown[] => [
  { type: 'assistant', uuid: `e-${id}`, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Edit', input: { file_path: file, old_string: from, new_string: to } }] } },
  { type: 'user', uuid: `r-${id}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }
]

test('rewind confirm', async () => {
  const session = '6c2d3e4f-5061-4b72-9c83-a4b5c6d7e8f9'
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  writeFileSync(join(root, 'client.ts'), 'export const retries = 0\n')
  writeFileSync(join(root, 'config.ts'), 'export const timeout = 5000\n')
  git(root, 'init', '-q')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'base')
  const log = logFor(sandbox, session)
  const { app, page } = await launchApp(sandbox, agentEnv(log))
  try {
    await page.setViewportSize(SIZE)
    mkdirSync(join(log, '..'), { recursive: true })
    writeFileSync(log, line({ type: 'assistant', uuid: 'a0', timestamp: iso(), message: { role: 'assistant', content: [{ type: 'text', text: 'Ready when you are.' }] } }))
    const pane = await openChat(page)
    writeSession(sandbox, session, 'Upload retries', 'idle')
    const chat = pane.locator('.chat')
    await expect(chat.locator('.chat-say')).toContainText('Ready when you are.', { timeout: 20_000 })
    const box = chat.getByRole('textbox', { name: 'Message' })
    await box.fill('Add retry with backoff to uploads')
    await box.press('Enter')
    await expect(chat.locator('.chat-say').last()).toHaveText('Echo: Add retry with backoff to uploads', { timeout: 20_000 })
    await expect.poll(() => git(root, 'for-each-ref', 'refs/dawsha/checkpoints'), { timeout: 15_000 }).not.toBe('')
    const base = realpathSync.native(root)
    writeFileSync(join(base, 'client.ts'), 'export const retries = 3\n')
    writeFileSync(join(base, 'config.ts'), 'export const timeout = 30000\n')
    writeFileSync(join(base, 'retry.test.ts'), 'test("retries", () => {})\n')
    const records = [
      ...edit('t1', join(base, 'client.ts'), 'retries = 0', 'retries = 3'),
      ...edit('t2', join(base, 'config.ts'), 'timeout = 5000', 'timeout = 30000'),
      { type: 'assistant', uuid: 'w1', timestamp: iso(), message: { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'Write', input: { file_path: join(base, 'retry.test.ts'), content: 'test("retries", () => {})\n' } }] } },
      { type: 'user', uuid: 'w2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3', content: 'ok' }] } }
    ]
    appendFileSync(log, records.map(line).join(''))
    await expect(chat.locator('.chat-tool')).toHaveCount(3, { timeout: 15_000 })
    const message = chat.locator('.chat-you').first()
    await message.hover()
    await message.getByRole('button', { name: 'Rewind to here' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Rewind to before')
    await expect(dialog.locator('.rewind-li', { hasText: 'retry.test.ts' })).toBeVisible({ timeout: 20_000 })
    // The sandbox folder is a temp path; leave it out of the picture.
    await page.addStyleTag({ content: '.rewind-dir { display: none }' })
    await page.waitForTimeout(600)
    await shot(page, 'rewind-confirm')
  } finally {
    await closeApp(app)
  }
})

test('reply summary with a diff and checks', async () => {
  const session = '7a1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  const failing = "console.log('Tests  2 failed | 146 passed (148)'); console.log('  x parseDate > keeps an explicit offset'); console.log('    Expected: 08:00'); process.exit(1)"
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'dates.ts'), 'const trimmed = input.trim()\nreturn new Date(trimmed)\n}\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true, packageManager: 'npm@10.0.0', scripts: { build: 'node -e "process.exit(0)"', test: `node -e "${failing.replace(/"/g, '\\"')}"` } }))
  git(root, 'init', '-q', '-b', 'fix/date-parsing')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'base')
  git(root, 'update-ref', `refs/dawsha/checkpoints/${session}/${createHash('sha1').update('u1').digest('hex').slice(0, 16)}`, 'HEAD')
  writeFileSync(join(root, 'src', 'dates.ts'), 'const trimmed = input.trim()\nconst hasZone = /z$/i.test(trimmed)\nreturn new Date(hasZone ? trimmed : `${trimmed}Z`)\n}\n')
  writeFileSync(join(root, 'src', 'dates.test.ts'), 'export const created = true\n')
  const log = logFor(sandbox, session)
  const { app, page } = await launchApp(sandbox, agentEnv(log))
  try {
    await page.setViewportSize(SIZE)
    await page.keyboard.press('Control+K')
    await page.locator('#palette-input').fill('Checks after each reply in Smoke')
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Checks after each reply in Smoke' })
    await dialog.getByLabel('npm run build').check()
    await dialog.getByLabel('npm run test').check()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toHaveCount(0)

    mkdirSync(join(log, '..'), { recursive: true })
    writeFileSync(log, line({ type: 'user', uuid: 'u1', timestamp: iso(), message: { role: 'user', content: 'Fix date parsing' } }))
    const pane = await openChat(page)
    writeSession(sandbox, session, 'Fix date parsing', 'busy')
    await expect(pane.locator('.chat-working')).toContainText('Esc to interrupt', { timeout: 20_000 })
    const records = [
      ...edit('t1', 'src/dates.ts', 'return new Date(trimmed)', 'const hasZone = /z$/i.test(trimmed)\nreturn new Date(hasZone ? trimmed : `${trimmed}Z`)'),
      { type: 'assistant', uuid: 'w1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Write', input: { file_path: 'src/dates.test.ts', content: 'export const created = true\n' } }] } },
      { type: 'user', uuid: 'w2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } },
      { type: 'assistant', uuid: 'a1', timestamp: iso(), message: { role: 'assistant', content: [{ type: 'text', text: 'Dates without a time zone are now read as UTC.' }] } }
    ]
    appendFileSync(log, records.map(line).join(''))
    writeSession(sandbox, session, 'Fix date parsing', 'idle')
    const card = pane.locator('.chat-turn-summary')
    await expect(card.locator('.turn-check')).toHaveCount(2, { timeout: 30_000 })
    await expect(card.locator('.turn-check', { hasText: 'npm run build' })).toContainText(/passed/, { timeout: 60_000 })
    await expect(card.locator('.turn-check', { hasText: 'npm run test' })).toContainText(/failed/, { timeout: 60_000 })
    await expect(card.getByRole('button', { name: /Undo this reply/ })).toBeVisible({ timeout: 20_000 })
    await card.locator('.chat-turn-file', { hasText: 'dates.ts' }).first().click()
    await expect(card.locator('.turn-diff .turn-ln.add').first()).toBeVisible({ timeout: 20_000 })
    await card.locator('.turn-check-out').scrollIntoViewIfNeeded()
    await page.mouse.move(5, 5)
    await page.waitForTimeout(600)
    await shot(page, 'reply-summary')
  } finally {
    await closeApp(app)
  }
})

test('the calmer sidebar with the plan and context', async () => {
  const session = '5b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e9'
  const sandbox = createSandbox()
  const log = logFor(sandbox, session)
  const { app, page } = await launchApp(sandbox, agentEnv(log))
  try {
    await page.setViewportSize(SIZE)
    const todos = [
      ['Find every place totals are computed', 'completed'],
      ['Move the math into billing/totals.ts', 'completed'],
      ['Add tests for rounding', 'completed'],
      ['Update callers in invoice.ts', 'in_progress'],
      ['Update callers in the PDF export', 'pending'],
      ['Run the full test suite', 'pending']
    ].map(([content, status]) => ({ content, status, activeForm: content }))
    mkdirSync(join(log, '..'), { recursive: true })
    writeFileSync(log, [
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'Move invoice totals into billing/totals.ts' } },
      { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'I will move the totals math into billing/totals.ts, add tests, then update each caller.' }] } },
      { type: 'assistant', uuid: 'a2', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'p1', name: 'TodoWrite', input: { todos } }] } }
    ].map(line).join(''))
    mkdirSync(sandbox.opsDir, { recursive: true })
    writeFileSync(join(sandbox.opsDir, `${session}.json`), JSON.stringify({ v: 1, sessionId: session, cwd: sandbox.projectFolder, updatedAt: Date.now(), ended: false, model: 'claude-opus-5-5', agents: [], context: { percent: 62, tokens: 124_000, window: 200_000, stage: 'fine' }, compactions: 0, limits: [], files: [], checks: [] }), 'utf8')
    const pane = await openChat(page)
    writeSession(sandbox, session, 'Billing refactor', 'busy')
    await expect(pane.locator('.plan-bar')).toBeVisible({ timeout: 20_000 })
    await expect(pane.getByRole('button', { name: /^Context 62% full/ })).toBeVisible({ timeout: 20_000 })
    await page.mouse.move(5, 5)
    await page.addStyleTag({ content: '.chat-you .chat-bell { display: none }' })
    await page.waitForTimeout(800)
    await shot(page, 'sidebar-plan-context')
  } finally {
    await closeApp(app)
  }
})
