import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeBounded, createSandbox, launchApp, type Sandbox } from './helpers'

const CLAUDE_ID = '11111111-2222-4333-8444-555555555555'
const CODEX_ID = '019aaaaa-0000-7000-8000-0000000000dd'
const NEW_CLAUDE = /^New Claude session in Smoke$/

const lines = (...records: unknown[]): string => `${records.map((record) => JSON.stringify(record)).join('\n')}\n`

function seedClaude(sandbox: Sandbox): void {
  const dir = join(sandbox.claudeHome, 'projects', 'smoke-slug')
  mkdirSync(dir, { recursive: true })
  const now = new Date()
  writeFileSync(
    join(dir, `${CLAUDE_ID}.jsonl`),
    lines({
      type: 'assistant',
      timestamp: now.toISOString(),
      cwd: sandbox.projectFolder,
      sessionId: CLAUDE_ID,
      message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 400, cache_creation_input_tokens: 500 } }
    })
  )
  writeFileSync(
    join(sandbox.userData, 'usage-history.json'),
    JSON.stringify({ v: 1, limits: [], costs: { [CLAUDE_ID]: { at: now.getTime() - 1000, usd: 1.84, cwd: sandbox.projectFolder } } }),
    'utf8'
  )
}

function writeClaudeSession(sandbox: Sandbox): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${CLAUDE_ID}.json`),
    JSON.stringify({
      pid: process.pid,
      sessionId: CLAUDE_ID,
      cwd: sandbox.projectFolder,
      name: 'Add dark mode toggle',
      nameSource: 'user',
      status: 'idle',
      startedAt: now + 1000,
      updatedAt: now + 1000
    }),
    'utf8'
  )
}

function seedCodex(sandbox: Sandbox): void {
  const dir = join(sandbox.codexHome, 'sessions', '2026', '10', '08')
  mkdirSync(dir, { recursive: true })
  const now = new Date()
  writeFileSync(
    join(dir, `rollout-2026-10-08T12-00-00-${CODEX_ID}.jsonl`),
    lines(
      { type: 'session_meta', timestamp: now.toISOString(), payload: { id: CODEX_ID, cwd: sandbox.projectFolder, timestamp: new Date(Date.now() + 1000).toISOString() } },
      { type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
      {
        type: 'event_msg',
        timestamp: now.toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 300 }, model_context_window: 200000 }
        }
      }
    )
  )
}

test('a Claude pane shows time, tokens and cost and the sidebar totals today for the project', async () => {
  const sandbox = createSandbox()
  seedClaude(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    const rows = page.locator('.proj-today')
    await expect(rows).toHaveCount(1, { timeout: 20_000 })
    await expect(rows).toHaveText('$1.84')
    await expect(rows).toHaveAttribute('aria-label', 'today $1.84 · 1.0K')
    await rows.hover()
    await expect(rows).toHaveAttribute('title', 'Today\nClaude: $1.84 · 1.0K tokens')

    await page.getByRole('button', { name: NEW_CLAUDE }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    await expect(page.locator('.pane-info .info-elapsed')).toHaveText(/^(<1m|\d+m)$/, { timeout: 20_000 })
    await expect(page.locator('.pane-info .info-tokens')).toHaveCount(0)
    writeClaudeSession(sandbox)
    await expect(page.locator('.pane-info .info-tokens')).toHaveText('1.0K tokens', { timeout: 20_000 })
    await expect(page.locator('.pane-info .info-cost')).toHaveText('$1.84')
  } finally {
    await closeBounded(app)
  }
})

test('a Codex pane shows tokens without cost and the sidebar total has no cost part', async () => {
  const sandbox = createSandbox()
  seedCodex(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(page.locator('.proj-today')).toHaveText('1.3K', { timeout: 20_000 })
    await expect(page.locator('.proj-today')).toHaveAttribute('aria-label', 'today 1.3K')
    await page.getByRole('button', { name: 'Project actions for Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Codex session' }).click()
    await expect(page.locator('.pane-info .info-tokens')).toHaveText('1.3K tokens', { timeout: 20_000 })
    await expect(page.locator('.pane-info .info-elapsed')).toHaveCount(1)
    await expect(page.locator('.pane-info .info-cost')).toHaveCount(0)
  } finally {
    await closeBounded(app)
  }
})

test('nothing is shown for a project with no usage today', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_CLAUDE }).click()
    await expect(page.locator('.pane-info .info-elapsed')).toHaveCount(1, { timeout: 20_000 })
    await expect(page.locator('.proj-today')).toHaveCount(0)
    await expect(page.locator('.pane-info .info-tokens')).toHaveCount(0)
    await expect(page.locator('.pane-info .info-cost')).toHaveCount(0)
  } finally {
    await closeBounded(app)
  }
})
