import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const AGENT = resolve(__dirname, '../support/chatAgent.cjs')
const SESSION = '6c2d3e4f-5061-4b72-9c83-a4b5c6d7e8f9'
const logPath = (sandbox: Sandbox): string => join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'), `${SESSION}.jsonl`)
const line = (record: unknown): string => JSON.stringify(record) + '\n'

function agentEnv(sandbox: Sandbox): Record<string, string> {
  const node = process.execPath
  return {
    CHAT_LOG: logPath(sandbox),
    DAWSHA_CLAUDE_COMMAND: node,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([AGENT, 'claude']),
    DAWSHA_CODEX_COMMAND: node,
    DAWSHA_CODEX_ARGS: JSON.stringify([AGENT, 'codex']),
    DAWSHA_GEMINI_COMMAND: node,
    DAWSHA_GEMINI_ARGS: JSON.stringify([AGENT, 'gemini'])
  }
}

function makeRepo(sandbox: Sandbox): void {
  const run = (...args: string[]): void => void execFileSync('git', args, { cwd: sandbox.projectFolder })
  run('init', '-q')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'Test')
  run('config', 'core.autocrlf', 'false')
  writeFileSync(join(sandbox.projectFolder, 'client.ts'), 'original\n')
  run('add', '-A')
  run('commit', '-qm', 'base')
}

function writeSession(sandbox: Sandbox): void {
  const now = Date.now()
  writeFileSync(join(sandbox.sessionsDir, `${SESSION}.json`), JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, name: 'Upload retries', nameSource: 'user', status: 'idle', startedAt: now + 1000, updatedAt: now + 1000 }), 'utf8')
}

/** The agent changing client.ts and creating retry.test.ts, as it would be logged. */
function agentEdits(sandbox: Sandbox, ago = 0): void {
  const at = new Date(Date.now() - ago).toISOString()
  const base = realpathSync.native(sandbox.projectFolder)
  const client = join(base, 'client.ts')
  const created = join(base, 'retry.test.ts')
  writeFileSync(client, 'with retry\n')
  writeFileSync(created, 'test\n')
  appendFileSync(logPath(sandbox), line({ type: 'assistant', uuid: 'e1', timestamp: at, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'te1', name: 'Edit', input: { file_path: client, old_string: 'original', new_string: 'with retry' } }] } }))
  appendFileSync(logPath(sandbox), line({ type: 'user', uuid: 'e2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'te1', content: 'ok' }] } }))
  appendFileSync(logPath(sandbox), line({ type: 'assistant', uuid: 'e3', timestamp: at, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'te2', name: 'Write', input: { file_path: created, content: 'test\n' } }] } }))
  appendFileSync(logPath(sandbox), line({ type: 'user', uuid: 'e4', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'te2', content: 'ok' }] } }))
}

async function openChat(page: Page, sandbox: Sandbox): Promise<Locator> {
  mkdirSync(join(logPath(sandbox), '..'), { recursive: true })
  writeFileSync(logPath(sandbox), line({ type: 'assistant', uuid: 'a0', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: 'Ready when you are.' }] } }))
  await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
  await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
  writeSession(sandbox)
  const pane = page.locator('.pane').first()
  await pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Chat', exact: true }).click()
  const chat = pane.locator('.chat')
  await expect(chat.locator('.chat-say')).toContainText('Ready when you are.', { timeout: 20_000 })
  return chat
}

async function sendFirst(chat: Locator, sandbox: Sandbox): Promise<void> {
  const box = chat.getByRole('textbox', { name: 'Message' })
  await box.fill('Add retry with backoff')
  await box.press('Enter')
  await expect(chat.locator('.chat-say').last()).toHaveText('Echo: Add retry with backoff', { timeout: 20_000 })
  await expect.poll(() => execFileSync('git', ['for-each-ref', 'refs/dawsha/checkpoints'], { cwd: sandbox.projectFolder, encoding: 'utf8' }), { timeout: 15_000 }).not.toBe('')
  agentEdits(sandbox)
  await expect(chat.locator('.chat-tool')).toHaveCount(2, { timeout: 15_000 })
}

const read = (sandbox: Sandbox, file: string): string => readFileSync(join(sandbox.projectFolder, file), 'utf8')

test('rewind names every file, puts them back, dims later turns and Redo restores', async () => {
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const chat = await openChat(page, sandbox)
    await sendFirst(chat, sandbox)
    const message = chat.locator('.chat-you').first()
    await message.hover()
    await expect(message.getByRole('button', { name: 'Edit' })).toBeEnabled()
    await message.getByRole('button', { name: 'Rewind to here' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Rewind to before “Add retry with backoff”')
    await expect(dialog).toContainText('client.ts')
    await expect(dialog.locator('.rewind-li', { hasText: 'retry.test.ts' })).toContainText('new, will be deleted')
    await dialog.getByRole('button', { name: 'Put back 2 files' }).click()
    await expect.poll(() => read(sandbox, 'client.ts')).toBe('original\n')
    await expect.poll(() => existsSync(join(sandbox.projectFolder, 'retry.test.ts'))).toBe(false)
    const mark = chat.locator('.chat-rewind-mark')
    await expect(mark).toContainText('2 files put back')
    await expect(chat.locator('.chat-undone').first()).toBeVisible()
    await mark.getByRole('button', { name: 'Redo' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Redo 2 files' }).click()
    await expect.poll(() => read(sandbox, 'client.ts')).toBe('with retry\n')
    await expect.poll(() => existsSync(join(sandbox.projectFolder, 'retry.test.ts'))).toBe(true)
    await expect(chat.locator('.chat-rewind-mark')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('files changed after the reply are kept and listed as changed since', async () => {
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const chat = await openChat(page, sandbox)
    const box = chat.getByRole('textbox', { name: 'Message' })
    await box.fill('Add retry with backoff')
    await box.press('Enter')
    await expect(chat.locator('.chat-say').last()).toHaveText('Echo: Add retry with backoff', { timeout: 20_000 })
    await expect.poll(() => execFileSync('git', ['for-each-ref', 'refs/dawsha/checkpoints'], { cwd: sandbox.projectFolder, encoding: 'utf8' }), { timeout: 15_000 }).not.toBe('')
    agentEdits(sandbox)
    const later = new Date(Date.now() + 120_000)
    utimesSync(join(sandbox.projectFolder, 'client.ts'), later, later)
    await expect(chat.locator('.chat-tool')).toHaveCount(2, { timeout: 15_000 })
    const message = chat.locator('.chat-you').first()
    await message.hover()
    await message.getByRole('button', { name: 'Rewind to here' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.locator('.rewind-kept')).toContainText('Changed since, kept', { timeout: 20_000 })
    await expect(dialog.locator('.rewind-kept')).toContainText('client.ts')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(read(sandbox, 'client.ts')).toBe('with retry\n')
  } finally {
    await closeApp(app)
  }
})

test('edit and send puts files back then sends the new text; Esc cancels', async () => {
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const chat = await openChat(page, sandbox)
    await sendFirst(chat, sandbox)
    const message = chat.locator('.chat-you').first()
    await message.hover()
    await message.getByRole('button', { name: 'Edit' }).click()
    const editor = chat.getByRole('group', { name: 'Edit message' })
    await expect(editor).toContainText('Puts back 2 files this and later replies changed, then sends')
    await expect(chat.locator('.chat-undone').first()).toBeVisible()
    await editor.getByRole('textbox').press('Escape')
    await expect(editor).toHaveCount(0)
    expect(read(sandbox, 'client.ts')).toBe('with retry\n')
    await message.hover()
    await message.getByRole('button', { name: 'Edit' }).click()
    const box = chat.getByRole('group', { name: 'Edit message' }).getByRole('textbox')
    await box.fill('Add retry, cap the wait at 10 seconds')
    await box.press('Control+Enter')
    await expect.poll(() => read(sandbox, 'client.ts'), { timeout: 30_000 }).toBe('original\n')
    await expect(chat.locator('.chat-say').last()).toHaveText('Echo: Add retry, cap the wait at 10 seconds', { timeout: 20_000 })
  } finally {
    await closeApp(app)
  }
})

test('try another way starts a second session in its own worktree with the snapshot files', async () => {
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const chat = await openChat(page, sandbox)
    await sendFirst(chat, sandbox)
    const message = chat.locator('.chat-you').first()
    await message.hover()
    await message.getByRole('button', { name: 'Try another way' }).click()
    const dialog = page.getByRole('dialog', { name: /Try another way from/ })
    await expect(dialog.getByRole('tab', { name: 'Claude' })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('checkbox', { name: 'Bring the conversation up to this message' })).toBeChecked()
    await dialog.getByRole('tab', { name: 'Codex' }).click()
    await dialog.getByRole('button', { name: 'Start try 2' }).click()
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })
    const worktree = `${sandbox.projectFolder}-preset-`
    const listed = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: sandbox.projectFolder, encoding: 'utf8' }).replace(/\\/g, '/')
    const path = listed.split('\n').map((l) => l.replace('worktree ', '')).find((l) => l.includes('-preset-'))
    expect(path).toBeTruthy()
    expect(path!.toLowerCase()).toContain(worktree.replace(/\\/g, '/').toLowerCase().split('/').pop()!)
    expect(readFileSync(join(path!, 'client.ts'), 'utf8')).toBe('original\n')
    expect(existsSync(join(path!, 'retry.test.ts'))).toBe(false)
    await expect(page.getByText('Upload retries · try 2').first()).toBeVisible()
    expect(read(sandbox, 'client.ts')).toBe('with retry\n')
  } finally {
    await closeApp(app)
  }
})
