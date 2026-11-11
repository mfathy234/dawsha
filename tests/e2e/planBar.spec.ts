import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const AGENT = resolve(__dirname, '../support/chatAgent.cjs')
const SESSION = '6c2d3e4f-5061-4b72-8c83-a4b5c6d7e8f9'
const SCREENS = 'test-results/screens'

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

type Status = 'pending' | 'in_progress' | 'completed'
const todoWrite = (id: string, items: [string, Status][]): unknown => ({
  type: 'assistant',
  uuid: `a-${id}`,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'TodoWrite', input: { todos: items.map(([content, status]) => ({ content, status, activeForm: content })) } }] }
})

const SEVEN: [string, Status][] = [
  ['Find every place totals are computed', 'completed'],
  ['Move the math into billing/totals.ts', 'completed'],
  ['Add tests for rounding', 'completed'],
  ['Update callers in invoice.ts', 'in_progress'],
  ['Update callers in the PDF export', 'pending'],
  ['Remove the old helpers', 'pending'],
  ['Run the full test suite', 'pending']
]

function writeLog(sandbox: Sandbox, records: unknown[]): void {
  mkdirSync(join(logPath(sandbox), '..'), { recursive: true })
  writeFileSync(logPath(sandbox), records.map(line).join(''))
}

async function startClaude(page: Page, sandbox: Sandbox): Promise<Locator> {
  await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
  await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${SESSION}.json`),
    JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, name: 'Billing refactor', nameSource: 'user', status: 'idle', startedAt: now + 1000, updatedAt: now + 1000 }),
    'utf8'
  )
  const pane = page.locator('.pane').first()
  await pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Chat', exact: true }).click()
  return pane
}

test('the plan stays pinned above the thread, opens to the checklist, and hides when it is done or cleared', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeLog(sandbox, [{ type: 'user', uuid: 'u1', message: { role: 'user', content: 'Refactor billing' } }, todoWrite('t1', SEVEN)])
    const pane = await startClaude(page, sandbox)
    const bar = pane.locator('.plan-bar')
    await expect(bar).toBeVisible({ timeout: 15_000 })
    await expect(bar.locator('.plan-n')).toHaveText('3 of 7')
    await expect(bar.locator('.plan-now')).toHaveText('Update callers in invoice.ts')
    await expect(bar).toHaveAttribute('aria-expanded', 'false')
    const width = await bar.locator('.plan-prog i').evaluate((node) => (node as HTMLElement).style.width)
    expect(width).toBe('43%')
    await expect(pane.locator('.plan-list')).toBeHidden()

    // It sits above the thread, not inside the part that scrolls.
    const barBox = (await bar.boundingBox())!
    const feedBox = (await pane.locator('.chat-feedwrap').boundingBox())!
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(feedBox.y + 1)

    // The sidebar row says the same.
    await expect(page.locator('.kept-session-row:not(.closed) .sess-meta').first()).toContainText('3 of 7')

    await bar.click()
    await expect(bar).toHaveAttribute('aria-expanded', 'true')
    const list = pane.locator('.plan-list .chat-todos')
    await expect(list.locator('li')).toHaveCount(7)
    await expect(list.locator('li.completed')).toHaveCount(3)
    await expect(list.locator('li.in_progress .sr-only')).toHaveText('In progress: ')
    await expect(list.locator('li.pending').first().locator('.sr-only')).toHaveText('To do: ')
    mkdirSync(SCREENS, { recursive: true })
    await pane.screenshot({ path: join(SCREENS, '186-plan-open.png') })

    await bar.click()
    await expect(bar).toHaveAttribute('aria-expanded', 'false')
    await expect(pane.locator('.plan-list')).toBeHidden()

    // Progress moves with the log.
    const next: [string, Status][] = SEVEN.map(([text], index) => [text, index < 4 ? 'completed' : index === 4 ? 'in_progress' : 'pending'])
    appendFileSync(logPath(sandbox), line(todoWrite('t2', next)))
    await expect(bar.locator('.plan-n')).toHaveText('4 of 7', { timeout: 15_000 })
    await expect(bar.locator('.plan-now')).toHaveText('Update callers in the PDF export')

    // Every task done: the bar goes away.
    appendFileSync(logPath(sandbox), line(todoWrite('t3', next.map(([text]) => [text, 'completed'] as [string, Status]))))
    await expect(pane.locator('.chat-plan')).toBeHidden({ timeout: 15_000 })

    // A new list brings it back, and clearing the list hides it again.
    appendFileSync(logPath(sandbox), line(todoWrite('t4', SEVEN)))
    await expect(bar).toBeVisible({ timeout: 15_000 })
    appendFileSync(logPath(sandbox), line(todoWrite('t5', [])))
    await expect(pane.locator('.chat-plan')).toBeHidden({ timeout: 15_000 })
  } finally {
    await closeApp(app)
  }
})
