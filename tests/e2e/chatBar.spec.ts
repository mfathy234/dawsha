import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { activeTermId, bufferText, closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const AGENT = resolve(__dirname, '../support/chatAgent.cjs')
const SESSION = '5b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e9'
const line = (record: unknown): string => JSON.stringify(record) + '\n'
const logPath = (sandbox: Sandbox): string => join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'), `${SESSION}.jsonl`)

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

function writeLog(sandbox: Sandbox, records: unknown[]): void {
  mkdirSync(join(logPath(sandbox), '..'), { recursive: true })
  writeFileSync(logPath(sandbox), records.map(line).join(''))
}

function writeSession(sandbox: Sandbox, status: 'busy' | 'idle' = 'idle'): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${SESSION}.json`),
    JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, name: 'Billing refactor', nameSource: 'user', status, startedAt: now + 1000, updatedAt: now + 1000 }),
    'utf8'
  )
}

function writeOps(sandbox: Sandbox, percent: number, tokens: number): void {
  mkdirSync(sandbox.opsDir, { recursive: true })
  const snapshot = { v: 1, sessionId: SESSION, cwd: sandbox.projectFolder, updatedAt: Date.now(), ended: false, model: 'claude-opus-5-5', agents: [], context: { percent, tokens, window: 200_000, stage: 'fine' }, compactions: 0, limits: [], files: [], checks: [] }
  writeFileSync(join(sandbox.opsDir, `${SESSION}.json`), JSON.stringify(snapshot), 'utf8')
}

async function openChat(page: Page, sandbox: Sandbox, status: 'busy' | 'idle' = 'idle'): Promise<Locator> {
  await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
  await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
  writeSession(sandbox, status)
  const pane = page.locator('.pane').first()
  await pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Chat', exact: true }).click()
  return pane.locator('.chat')
}

const talk = [
  { type: 'user', uuid: 'u1', message: { role: 'user', content: 'Move invoice totals' } },
  { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'Moved invoice totals into billing/totals.ts.' }] } }
]

test('the context meter shows the share, opens its numbers, compacts and clears after a confirm', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeLog(sandbox, talk)
    writeOps(sandbox, 62, 124_000)
    const chat = await openChat(page, sandbox)
    const termId = await activeTermId(page)
    const meter = chat.getByRole('button', { name: /^Context 62% full/ })
    await expect(meter).toContainText('62%', { timeout: 15_000 })
    await expect(chat.locator('.chat-ctx-note')).toBeHidden()
    await meter.click()
    const pop = page.getByRole('dialog', { name: 'Context' })
    await expect(pop).toContainText('Context · 124K of 200K tokens')
    await pop.getByRole('button', { name: /Compact now/ }).click()
    await expect.poll(() => bufferText(page, termId), { timeout: 15_000 }).toContain('GOT "/compact"')

    await meter.click()
    await page.getByRole('dialog', { name: 'Context' }).getByRole('button', { name: /Clear and start fresh/ }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('Billing refactor')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await meter.click()
    await page.getByRole('dialog', { name: 'Context' }).getByRole('button', { name: /Clear and start fresh/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Clear Billing refactor' }).click()
    await expect.poll(() => bufferText(page, termId), { timeout: 15_000 }).toContain('GOT "/clear"')
  } finally {
    await closeApp(app)
  }
})

test('at 85 percent a note offers to compact; Not now hides it until the context drops', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeLog(sandbox, talk)
    writeOps(sandbox, 88, 176_000)
    const chat = await openChat(page, sandbox)
    const termId = await activeTermId(page)
    const note = chat.locator('.chat-ctx-note')
    await expect(note).toContainText("Context is 88% full. Compact now so Claude doesn't do it in the middle of the next task.", { timeout: 15_000 })
    await expect(chat.locator('.chat-ctx')).toHaveClass(/warn/)
    await note.getByRole('button', { name: 'Not now' }).click()
    await expect(note).toBeHidden()
    writeOps(sandbox, 90, 180_000)
    await page.waitForTimeout(2500)
    await expect(note).toBeHidden()
    writeOps(sandbox, 10, 20_000)
    await expect(chat.getByRole('button', { name: /^Context 10% full/ })).toBeVisible({ timeout: 15_000 })
    writeOps(sandbox, 89, 178_000)
    await expect(note).toBeVisible({ timeout: 15_000 })
    await note.getByRole('button', { name: 'Compact' }).click()
    await expect.poll(() => bufferText(page, termId), { timeout: 15_000 }).toContain('GOT "/compact"')
    await expect(note).toBeHidden()
  } finally {
    await closeApp(app)
  }
})

test('the model picker drives /model and /effort, leaves a quiet row and locks while the agent works', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeLog(sandbox, talk)
    writeOps(sandbox, 31, 62_000)
    const chat = await openChat(page, sandbox)
    const termId = await activeTermId(page)
    const pick = chat.locator('.chat-pick')
    await expect(pick).toContainText('Opus', { timeout: 15_000 })
    await pick.click()
    const pop = page.getByRole('dialog', { name: 'Model and effort' })
    await expect(pop).toContainText('Applies from your next message')
    await expect(pop.getByRole('menuitemradio', { name: /Opus/ })).toHaveAttribute('aria-checked', 'true')
    await pop.getByRole('menuitemradio', { name: 'Sonnet' }).click()
    await expect.poll(() => bufferText(page, termId), { timeout: 15_000 }).toContain('GOT "/model sonnet"')
    await expect(chat.locator('.chat-set')).toHaveText('Model set to Sonnet')
    await pick.click()
    await page.getByRole('dialog', { name: 'Model and effort' }).getByRole('radio', { name: 'high', exact: true }).click()
    await expect.poll(() => bufferText(page, termId), { timeout: 15_000 }).toContain('GOT "/effort high"')
    await expect(chat.locator('.chat-set').last()).toHaveText('Model set to Opus · high')
    await expect(pick).toContainText('· high')

    writeSession(sandbox, 'busy')
    await expect(pick).toBeDisabled({ timeout: 15_000 })
    await expect(pick).toHaveAttribute('title', 'Changes after this reply')
  } finally {
    await closeApp(app)
  }
})

test('a usage limit gets one card: continue elsewhere, send at the reset, or be told', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const resetsAt = Math.floor((Date.now() + 5000) / 1000) + 1
    writeLog(sandbox, [
      ...talk,
      { type: 'user', uuid: 'u2', message: { role: 'user', content: 'Now update the invoice PDF' } },
      { type: 'assistant', uuid: 'l1', apiError: 'usage_limit_reached', apiErrorParams: { rate_limit_info: { status: 'rejected', resetsAt } }, message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your session limit" }] } }
    ])
    const chat = await openChat(page, sandbox)
    const termId = await activeTermId(page)
    const card = chat.locator('.chat-limit')
    await expect(card).toContainText("Claude's usage limit is reached.", { timeout: 15_000 })
    await expect(card).toContainText('Your message above was not sent.')
    await expect(page.locator('.pane .state-pill-text').first()).toHaveText('Limit reached')
    await expect(card.getByRole('button', { name: 'Continue in Codex' })).toBeVisible()

    await card.getByRole('button', { name: 'Notify me at', exact: false }).click()
    await expect(card.getByRole('button', { name: 'Reminder set' })).toBeDisabled()

    await card.getByRole('button', { name: /^Send at / }).click()
    const queued = chat.locator('.chat-you.pending')
    await expect(queued).toContainText('Now update the invoice PDF')
    await expect(queued).toContainText(/Sends at \d\d:\d\d/)
    await expect(queued.getByRole('button', { name: 'Edit' })).toBeVisible()
    await expect(queued.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect.poll(() => bufferText(page, termId), { timeout: 30_000 }).toContain('GOT "Now update the invoice PDF"')
  } finally {
    await closeApp(app)
  }
})

test('continue in another agent opens the handoff with the stopped message in it', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const resetsAt = Math.floor((Date.now() + 3 * 3_600_000) / 1000)
    writeLog(sandbox, [
      ...talk,
      { type: 'user', uuid: 'u2', message: { role: 'user', content: 'Now update the invoice PDF' } },
      { type: 'assistant', uuid: 'l1', apiError: 'usage_limit_reached', apiErrorParams: { rate_limit_info: { status: 'rejected', resetsAt } }, message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your session limit" }] } }
    ])
    const chat = await openChat(page, sandbox)
    const card = chat.locator('.chat-limit')
    await expect(card).toContainText(/It resets at \d\d:\d\d, in [23]h/, { timeout: 15_000 })
    await card.getByRole('button', { name: 'Continue in Codex' }).click()
    const dialog = page.getByRole('dialog', { name: 'Continue in Codex' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('textarea')).toHaveValue(/Now update the invoice PDF/)
  } finally {
    await closeApp(app)
  }
})
