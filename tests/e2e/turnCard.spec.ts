import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const AGENT = resolve(__dirname, '../support/chatAgent.cjs')
const SESSION = '7a1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'
const line = (record: unknown): string => JSON.stringify(record) + '\n'
const logPath = (sandbox: Sandbox): string => join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'), `${SESSION}.jsonl`)

function git(folder: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd: folder, encoding: 'utf8' })
}

function agentEnv(sandbox: Sandbox): Record<string, string> {
  const node = process.execPath
  return { CHAT_LOG: logPath(sandbox), DAWSHA_CLAUDE_COMMAND: node, DAWSHA_CLAUDE_ARGS: JSON.stringify([AGENT, 'claude']) }
}

const bigBefore = Array.from({ length: 70 }, (_, i) => `row ${i}`).join('\n') + '\n'
const bigAfter = Array.from({ length: 70 }, (_, i) => `ROW ${i}`).join('\n') + '\n'

/** A repo with a checkpoint taken before the reply, and the reply's changes on disk. */
function makeRepo(sandbox: Sandbox, scripts: Record<string, string> = {}): void {
  const root = sandbox.projectFolder
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.ts'), 'const trimmed = input.trim()\nreturn new Date(trimmed)\n}\n')
  writeFileSync(join(root, 'big.ts'), bigBefore)
  writeFileSync(join(root, 'other.txt'), 'mine\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true, packageManager: 'npm@10.0.0', scripts }))
  git(root, 'init', '-q', '-b', 'fix/date-parsing')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'base')
  git(root, 'update-ref', `refs/dawsha/checkpoints/${SESSION}/${createHash('sha1').update('u1').digest('hex').slice(0, 16)}`, 'HEAD')
  writeFileSync(join(root, 'src', 'a.ts'), 'const trimmed = input.trim()\nconst hasZone = /z$/i.test(trimmed)\nreturn new Date(hasZone ? trimmed : `${trimmed}Z`)\n}\n')
  writeFileSync(join(root, 'big.ts'), bigAfter)
  writeFileSync(join(root, 'created.ts'), 'export const created = true\n')
  writeFileSync(join(root, 'other.txt'), 'mine, edited\n')
}

const iso = (offsetMs = 0): string => new Date(Date.now() + offsetMs).toISOString()

const userLine = (): string => line({ type: 'user', uuid: 'u1', timestamp: iso(), message: { role: 'user', content: 'Fix date parsing' } })
const replyLines = (): string => [
  { type: 'assistant', uuid: 'e1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'return new Date(trimmed)', new_string: 'const hasZone = /z$/i.test(trimmed)\nreturn new Date(hasZone ? trimmed : `${trimmed}Z`)' } }] } },
  { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  { type: 'assistant', uuid: 'e2', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Write', input: { file_path: 'created.ts', content: 'export const created = true\n' } }] } },
  { type: 'user', uuid: 'r2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } },
  { type: 'assistant', uuid: 'e3', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: 'big.ts', old_string: bigBefore.trimEnd(), new_string: bigAfter.trimEnd() } }] } },
  { type: 'user', uuid: 'r3', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3', content: 'ok' }] } },
  { type: 'assistant', uuid: 'a1', timestamp: iso(), message: { role: 'assistant', content: [{ type: 'text', text: 'Dates without a time zone are now read as UTC.' }] } }
].map(line).join('')

function writeSession(sandbox: Sandbox, status: 'busy' | 'idle'): void {
  const now = Date.now()
  writeFileSync(join(sandbox.sessionsDir, `${SESSION}.json`), JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, name: 'Fix date parsing', nameSource: 'user', status, startedAt: now + 1000, updatedAt: now + 1000 }), 'utf8')
}

/** Opens Chat on a session whose reply already finished. */
async function openFinished(page: Page, sandbox: Sandbox): Promise<Locator> {
  mkdirSync(join(logPath(sandbox), '..'), { recursive: true })
  writeFileSync(logPath(sandbox), userLine() + replyLines())
  await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
  await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
  writeSession(sandbox, 'idle')
  const pane = page.locator('.pane').first()
  await pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Chat', exact: true }).click()
  await expect(pane.locator('.chat-turn-summary')).toBeVisible({ timeout: 20_000 })
  return pane
}

test('a file in the summary opens its diff in place, and a long diff folds at 40 lines', async () => {
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const pane = await openFinished(page, sandbox)
    const card = pane.locator('.chat-turn-summary')
    await expect(card).toContainText('Changed 3 files')
    // The snapshot is looked up after the card shows; Undo appears with it.
    await expect(card.getByRole('button', { name: /Undo this reply/ })).toBeVisible({ timeout: 20_000 })
    const file = card.locator('.chat-turn-file', { hasText: 'a.ts' })
    await expect(file).toHaveAttribute('aria-expanded', 'false')
    await file.click()
    await expect(file).toHaveAttribute('aria-expanded', 'true')
    const diff = card.locator('.turn-diff').first()
    await expect(diff.locator('.turn-hunk')).toHaveCount(1)
    await expect(diff.locator('.turn-ln.add')).toHaveCount(2)
    await expect(diff.locator('.turn-ln.del')).toHaveCount(1)
    await expect(diff).toContainText('1 of 1 change')
    await expect(diff.getByRole('button', { name: 'Open in Files' })).toBeVisible()
    await expect(diff.getByRole('button', { name: 'Show all' })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/screens/turn-diff.png' })
    await file.click()
    await expect(card.locator('.turn-diff')).toHaveCount(0)

    await card.locator('.chat-turn-file', { hasText: 'big.ts' }).click()
    const big = card.locator('.turn-diff')
    await expect(big.locator('.turn-ln')).toHaveCount(39)
    await big.getByRole('button', { name: 'Show all' }).click()
    await expect(big.locator('.turn-ln')).toHaveCount(140)
    await expect(big.getByRole('button', { name: 'Open in Review' })).toHaveCount(0)

    // A save after the reply is said out loud.
    const later = new Date(Date.now() + 60_000)
    utimesSync(join(sandbox.projectFolder, 'src', 'a.ts'), later, later)
    await card.locator('.chat-turn-file', { hasText: 'a.ts' }).click()
    await expect(card.locator('.turn-diff-foot', { hasText: 'changed since this reply' })).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('Commit this reply stages only the reply\'s files, leaves other changes alone and then offers Push and a pull request', async () => {
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const pane = await openFinished(page, sandbox)
    const card = pane.locator('.chat-turn-summary')
    await card.getByRole('button', { name: 'Commit', exact: true }).click()
    const box = card.getByRole('textbox', { name: 'Commit message' })
    await expect(box).toHaveValue('fix: dates without a time zone are now read as UTC')
    await expect(card.locator('.turn-commit-note')).toHaveText('Commits these 3 files on fix/date-parsing. 1 other changed file stays uncommitted.')
    await page.screenshot({ path: 'test-results/screens/turn-commit.png' })

    await card.getByLabel('big.ts').uncheck()
    await expect(card.locator('.turn-commit-note')).toHaveText('Commits these 2 files on fix/date-parsing. 2 other changed files stay uncommitted.')
    await card.getByLabel('big.ts').check()
    await box.fill('fix: read dates without a time zone as UTC')
    await card.getByRole('button', { name: 'Commit 3 files' }).click()

    await expect(card.locator('.chat-turn-head')).toContainText('Committed')
    const hash = (await card.locator('.chat-turn-head .mono').textContent())?.trim() ?? ''
    expect(git(sandbox.projectFolder, 'rev-parse', '--short', 'HEAD').trim()).toBe(hash)
    expect(git(sandbox.projectFolder, 'log', '-1', '--format=%s').trim()).toBe('fix: read dates without a time zone as UTC')
    const committed = git(sandbox.projectFolder, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort()
    expect(committed).toEqual(['big.ts', 'created.ts', 'src/a.ts'])
    expect(git(sandbox.projectFolder, 'status', '--porcelain').trim()).toBe('M other.txt')

    await expect(card.getByRole('button', { name: 'Push' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Open pull request' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Review changes' })).toBeVisible()
    await expect(card.getByRole('button', { name: /Undo this reply/ })).toHaveCount(0)
    await expect(card).toContainText('Revert in Files')
    await page.screenshot({ path: 'test-results/screens/turn-committed.png' })
  } finally {
    await closeApp(app)
  }
})

test('a file saved after the reply is listed as having other changes and starts unticked', async () => {
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const pane = await openFinished(page, sandbox)
    const later = new Date(Date.now() + 60_000)
    utimesSync(join(sandbox.projectFolder, 'created.ts'), later, later)
    const card = pane.locator('.chat-turn-summary')
    await card.getByRole('button', { name: 'Commit', exact: true }).click()
    await expect(card.locator('.turn-commit-file', { hasText: 'created.ts' })).toContainText('also has other changes')
    await expect(card.getByLabel('created.ts, also has other changes')).not.toBeChecked()
    await expect(card.locator('.turn-commit-note')).toContainText('Commits these 2 files')
    await card.getByRole('button', { name: 'Cancel' }).click()
    await expect(card.locator('.turn-commit')).toHaveCount(0)
    expect(git(sandbox.projectFolder, 'log', '--oneline').trim().split('\n')).toHaveLength(1)
  } finally {
    await closeApp(app)
  }
})

test('checks run after a reply that changed files, show a row each, and failures go back to the agent', async () => {
  const sandbox = createSandbox()
  const failing = "console.log('Tests  2 failed | 146 passed (148)'); console.log('  ✕ parseDate › keeps an explicit offset'); console.log('    Expected: 08:00'); process.exit(1)"
  makeRepo(sandbox, { build: 'node -e "process.exit(0)"', test: `node -e "${failing.replace(/"/g, '\\"')}"` })
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    await page.keyboard.press('Control+K')
    await page.locator('#palette-input').fill('Checks after each reply in Smoke')
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Checks after each reply in Smoke' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Send failures to the agent automatically, up to 2 times in a row')).not.toBeChecked()
    await dialog.getByLabel('npm run build').check()
    await dialog.getByLabel('npm run test').check()
    await page.screenshot({ path: 'test-results/screens/turn-checks-dialog.png' })
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toHaveCount(0)

    mkdirSync(join(logPath(sandbox), '..'), { recursive: true })
    writeFileSync(logPath(sandbox), userLine())
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    writeSession(sandbox, 'busy')
    const pane = page.locator('.pane').first()
    await pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(pane.locator('.chat-working')).toContainText('Esc to interrupt', { timeout: 20_000 })
    appendFileSync(logPath(sandbox), replyLines())
    writeSession(sandbox, 'idle')

    const card = pane.locator('.chat-turn-summary')
    await expect(card.locator('.turn-check')).toHaveCount(2, { timeout: 30_000 })
    await expect(card.locator('.turn-check', { hasText: 'npm run build' })).toContainText(/passed · \d+s/, { timeout: 60_000 })
    const bad = card.locator('.turn-check', { hasText: 'npm run test' })
    await expect(bad).toContainText(/2 of 148 failed · \d+s/, { timeout: 60_000 })
    await expect(card.locator('.turn-check-out')).toContainText('keeps an explicit offset')
    await page.screenshot({ path: 'test-results/screens/turn-checks.png' })

    await card.getByRole('button', { name: 'Show full output' }).click()
    const output = page.getByRole('dialog', { name: 'Check output' })
    await expect(output).toContainText('Expected: 08:00')
    await output.getByRole('button', { name: 'Close', exact: true }).click()

    await card.getByRole('button', { name: 'Send failures to Claude' }).click()
    await expect(card.getByRole('button', { name: 'Send failures to Claude' })).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('opening a finished session runs no checks', async () => {
  const sandbox = createSandbox()
  makeRepo(sandbox, { build: 'node -e "process.exit(0)"' })
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const saved = await page.evaluate(async () => (await window.gridApi.runs.discover({ projectId: 'smoke', folder: (await window.gridApi.getSettings()).settings.projects[0].folder })).commands.map((command) => command.id))
    await page.evaluate((ids) => window.gridApi.updateSettings({ turnChecks: { smoke: { commandIds: ids, autoSend: false } } }), saved)
    const pane = await openFinished(page, sandbox)
    await expect(pane.locator('.chat-turn-summary')).toBeVisible()
    await page.waitForTimeout(1500)
    await expect(pane.locator('.turn-check')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
