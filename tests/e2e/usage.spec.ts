import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox, QUIT_BUDGET_MS } from './helpers'

const SCREENS = 'test-results/screens'
const CLAUDE_ID = '11111111-2222-4333-8444-555555555555'
const CODEX_ID = '019aaaaa-0000-7000-8000-0000000000aa'

const lines = (...records: unknown[]): string => `${records.map((record) => JSON.stringify(record)).join('\n')}\n`

function localDay(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function seedHomes(sandbox: Sandbox): void {
  const now = new Date()
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 3_600_000)
  const claudeDir = join(sandbox.claudeHome, 'projects', 'smoke-slug')
  mkdirSync(claudeDir, { recursive: true })
  const claudeLine = (id: string, when: Date, usage: Record<string, number>) => ({
    type: 'assistant',
    timestamp: when.toISOString(),
    cwd: sandbox.projectFolder,
    sessionId: CLAUDE_ID,
    message: { id, usage }
  })
  writeFileSync(
    join(claudeDir, `${CLAUDE_ID}.jsonl`),
    lines(
      claudeLine('m1', now, { input_tokens: 100, output_tokens: 400, cache_creation_input_tokens: 500, cache_read_input_tokens: 9000 }),
      claudeLine('m2', twoDaysAgo, { input_tokens: 50, output_tokens: 50 })
    )
  )
  const codexDir = join(sandbox.codexHome, 'sessions', '2026', '10', '08')
  mkdirSync(codexDir, { recursive: true })
  writeFileSync(
    join(codexDir, `rollout-2026-10-08T12-00-00-${CODEX_ID}.jsonl`),
    lines(
      { type: 'session_meta', timestamp: now.toISOString(), payload: { id: CODEX_ID, cwd: sandbox.projectFolder } },
      {
        type: 'event_msg',
        timestamp: now.toISOString(),
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 300, total_tokens: 5300 } }
        }
      }
    )
  )
  const geminiSlug = join(sandbox.geminiHome, 'tmp', 'smoke')
  mkdirSync(join(geminiSlug, 'chats'), { recursive: true })
  writeFileSync(join(geminiSlug, '.project_root'), sandbox.projectFolder, 'utf8')
  writeFileSync(
    join(geminiSlug, 'chats', 'session-2026-10-08T12-00-abcd1234.jsonl'),
    lines(
      { sessionId: 'abcd1234-0000-4000-8000-000000000000', startTime: now.toISOString() },
      { id: 'g1', type: 'gemini', timestamp: now.toISOString(), content: 'x', tokens: { input: 800, output: 100, cached: 300, thoughts: 0, tool: 0, total: 900 } }
    )
  )
  writeFileSync(
    join(sandbox.userData, 'usage-history.json'),
    JSON.stringify({
      v: 1,
      limits: [
        { at: now.getTime() - 3 * 3_600_000, w: { five_hour: 20, seven_day: 10 } },
        { at: now.getTime() - 3_600_000, w: { five_hour: 62, seven_day: 18 } }
      ],
      costs: { 'sess-1': { at: now.getTime() - 1000, usd: 4.25, cwd: sandbox.projectFolder } }
    }),
    'utf8'
  )
}

test('the usage view totals tokens and cost per day, project and agent from local fixtures', async () => {
  const sandbox = createSandbox()
  seedHomes(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'Usage', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Usage', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Usage', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('tab', { name: '7 days' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.usage-col')).toHaveCount(7)

    const today = localDay(new Date())
    const twoDaysAgo = localDay(new Date(Date.now() - 2 * 24 * 3_600_000))
    await expect(page.locator(`.usage-col[data-bucket="${today}"]`)).toHaveAttribute('data-total', '2900')
    await expect(page.locator(`.usage-col[data-bucket="${twoDaysAgo}"]`)).toHaveAttribute('data-total', '100')
    await expect(page.locator(`.usage-col[data-bucket="${today}"] .usage-seg`)).toHaveCount(3)
    await expect(page.locator(`.usage-col[data-bucket="${today}"]`)).toHaveAttribute('title', /Claude Code 1\.0K, Codex 1\.3K, Gemini 600/)

    const projects = page.locator('#usage-by-project tbody tr')
    await expect(projects).toHaveCount(1)
    await expect(projects.first().locator('td')).toHaveText(['Smoke', '3', '3.0K', '$4.25', /Codex/])

    const agentRow = (agent: string) => page.locator(`#usage-by-agent tbody tr[data-agent="${agent}"] td`)
    await expect(page.locator('#usage-by-agent th[aria-sort="descending"]')).toContainText('Tokens')
    await expect(agentRow('claude')).toHaveText([/Claude Code/, '1', '1.1K', '9.0K', '$4.25'])
    await expect(agentRow('codex')).toHaveText([/Codex/, '1', '1.3K', '4.0K', 'not reported'])
    await expect(agentRow('gemini')).toHaveText([/Gemini/, '1', '600', '300', 'not reported'])
    await expect(page.locator('#usage-by-agent tbody tr').first()).toHaveAttribute('data-agent', 'codex')
    await page.locator('#usage-by-agent [data-sort="agent:agent"]').click()
    await expect(page.locator('#usage-by-agent th[aria-sort="ascending"]')).toContainText('Agent')
    await expect(page.locator('#usage-by-agent tbody tr').first()).toHaveAttribute('data-agent', 'claude')

    await expect(page.locator('#usage-tile-tokens')).toContainText('3.0K')
    await expect(page.locator('#usage-tile-spend')).toContainText('$4.25')
    await expect(page.locator('.usage-meter[data-limit="five_hour"]')).toContainText('62% used')
    await expect(page.locator('.usage-meter[data-limit="seven_day"]')).toContainText('18% used')
    await expect(page.locator('.usage-notes')).toContainText('Codex and Gemini report tokens only')
    await page.screenshot({ path: join(SCREENS, '60-usage.png') })

    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await expect(page.locator('.usage-view')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Sessions', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Usage', exact: true }).click()
    await expect(page.locator('.usage-view')).toBeVisible()

    await page.getByRole('radio', { name: 'Cost' }).click()
    await expect(page.locator(`.usage-col[data-bucket="${today}"]`)).toHaveAttribute('data-total', '4.25')
    await expect(page.locator(`.usage-col[data-bucket="${today}"] .usage-seg`)).toHaveCount(1)
    await expect(page.locator(`.usage-col[data-bucket="${twoDaysAgo}"]`)).toHaveAttribute('data-total', '0')
    await page.getByRole('radio', { name: 'Tokens' }).click()

    await page.getByRole('tab', { name: 'Today' }).click()
    await expect(page.locator('.usage-col')).toHaveCount(24)
    await expect(page.locator('#usage-by-agent tbody tr[data-agent="claude"] td')).toHaveText([/Claude Code/, '1', '1.0K', '9.0K', '$4.25'])
    await page.getByRole('tab', { name: '30 days' }).click()
    await expect(page.locator('.usage-col')).toHaveCount(30)

    await page.getByRole('button', { name: 'Usage', exact: true }).click()
    await expect(page.locator('.usage-view')).toBeHidden()
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('explains empty and partial data instead of showing blank charts', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.keyboard.press('Control+k')
    await expect(page.locator('#palette-input')).toBeFocused()
    await page.keyboard.type('open usage')
    await page.keyboard.press('Enter')
    await expect(page.locator('.usage-view')).toBeVisible()
    await expect(page.locator('#usage-chart-empty')).toHaveText('No usage found in this range.')
    await expect(page.locator('#usage-limits-empty')).toContainText('No limit readings yet')
    await expect(page.locator('.usage-notes')).toContainText('No Claude Code history found')
    await expect(page.locator('.usage-notes')).toContainText('No Codex history found')
    await expect(page.locator('.usage-notes')).toContainText('Cost appears for Claude Code sessions')
    await expect(page.locator('#usage-by-project')).toHaveCount(0)
    await expect(page.locator('#usage-by-agent tbody tr')).toHaveCount(3)
    await page.getByRole('radio', { name: 'Cost' }).click()
    await expect(page.locator('#usage-chart-empty')).toContainText('No cost was reported in this range')
    await page.screenshot({ path: join(SCREENS, '61-usage-empty.png') })
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('sidebar session returns to its already-focused pane from Usage', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await page.getByRole('button', { name: 'Usage', exact: true }).click()
    await expect(page.locator('.usage-view')).toBeVisible()
    await page.locator('.sidebar .sess-row').click()
    await expect(page.locator('.usage-view')).toBeHidden()
    await expect(page.locator('.pane')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('records limit readings and session cost from the status-line payloads for later days', async () => {
  const sandbox = createSandbox()
  const statusDir = join(sandbox.userData, 'status')
  mkdirSync(statusDir, { recursive: true })
  writeFileSync(
    join(statusDir, 'sess-live.json'),
    JSON.stringify({
      session_id: 'sess-live',
      cwd: sandbox.projectFolder,
      model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
      cost: { total_cost_usd: 1.75 },
      rate_limits: { five_hour: { used_percentage: 33, resets_at: Math.floor(Date.now() / 1000) + 3600 } }
    }),
    'utf8'
  )
  const { app, page } = await launchApp(sandbox)
  try {
    const history = join(sandbox.userData, 'usage-history.json')
    await expect.poll(() => existsSync(history) && readFileSync(history, 'utf8'), { timeout: 20_000 }).toContain('sess-live')
    await page.getByRole('button', { name: 'Usage', exact: true }).click()
    await expect(page.locator('.usage-meter[data-limit="five_hour"]')).toContainText('33% used', { timeout: 20_000 })
    await page.getByRole('tab', { name: '30 days' }).click()
    await expect(page.locator('#usage-by-agent tbody tr[data-agent="claude"] td').last()).toHaveText('$1.75')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
