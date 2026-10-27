import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp, type Sandbox } from './helpers'
import { contrastRatio } from '../../src/shared/contrast'

const SHOTS = process.env.DAWSHA_SHOTS ?? ''
const readSettings = (userData: string) => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
const NOW = Date.now()
const slug = (folder: string): string => folder.replace(/[^A-Za-z0-9]/g, '-')
const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n')
const iso = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString()
const touch = (path: string, minutes: number): void => utimesSync(path, new Date(NOW - minutes * 60_000), new Date(NOW - minutes * 60_000))
const usage = (input: number, output: number) => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })
const PARENT = '4d1b16b0-2a58-42e8-a971-0fadf4e0f3e4'
const OTHER_PARENT = '5e2c27c1-3b69-53f9-b082-1fbe05f4f5f5'
const CODEX_ROOT = '01a171f0-a764-7871-b483-453daf64460c'
const CODEX_SPAWN = '01a171f2-4dfd-7003-bf0f-a0a036758b6f'
const CODEX_GUARD = '01a171f3-1111-7003-bf0f-a0a036758b6f'
const RESULT = 'Rebased the branch and all 14 tests pass.'

function claudeAgent(dir: string, id: string, meta: Record<string, unknown>, ageMinutes: number, durationMinutes: number, cwd: string, final: string | null): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', spawnDepth: 1, requestShape: 'background', model: 'sonnet', ...meta }))
  const first = { type: 'user', timestamp: iso(ageMinutes + durationMinutes), cwd, isSidechain: true, message: { role: 'user', content: 'Go' } }
  const last = final
    ? { type: 'assistant', timestamp: iso(ageMinutes), message: { id: `m-${id}`, model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage: usage(100, 400), content: [{ type: 'text', text: final }] } }
    : { type: 'assistant', timestamp: iso(ageMinutes), message: { id: `m-${id}`, model: 'claude-sonnet-5-5', stop_reason: 'tool_use', usage: usage(100, 400), content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }
  writeFileSync(join(dir, `agent-${id}.jsonl`), lines(first, last))
  touch(join(dir, `agent-${id}.jsonl`), ageMinutes)
}

function rollout(sandbox: Sandbox, id: string, records: unknown[], ageMinutes: number): void {
  const at = new Date(NOW - 60 * 60_000)
  const dir = join(sandbox.codexHome, 'sessions', String(at.getFullYear()), String(at.getMonth() + 1).padStart(2, '0'), String(at.getDate()).padStart(2, '0'))
  mkdirSync(dir, { recursive: true })
  const p = (n: number) => String(n).padStart(2, '0')
  const path = join(dir, `rollout-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}-${p(at.getMinutes())}-00-${id}.jsonl`)
  writeFileSync(path, lines(...records))
  touch(path, ageMinutes)
}

function seed(sandbox: Sandbox): void {
  const folder = sandbox.projectFolder
  const dir = join(sandbox.claudeHome, 'projects', slug(folder))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${PARENT}.jsonl`), lines({ type: 'user', timestamp: iso(90), cwd: folder, message: { content: 'Polish the release' } }, { type: 'ai-title', aiTitle: 'Release polish' }))
  const sub = join(dir, PARENT, 'subagents')
  claudeAgent(sub, 'run1', { description: 'Option A grid pass' }, 0.3, 25, folder, null)
  claudeAgent(sub, 'done1', { description: 'Sidebar session features', finished: true }, 20, 30, folder, RESULT)
  claudeAgent(sub, 'done2', { description: 'Handoff export', agentType: 'Explore', finished: true }, 75, 12, folder, 'Found the export code in handoff.ts.')
  claudeAgent(sub, 'old1', { description: 'Ancient cleanup', finished: true }, 180, 10, folder, 'Cleaned up.')
  const elsewhere = join(sandbox.root, 'elsewhere', 'Trial')
  claudeAgent(join(sandbox.claudeHome, 'projects', slug(elsewhere), OTHER_PARENT, 'subagents'), 'oth1', { description: 'Copy tenant settings', agentType: 'Explore', finished: true }, 15, 6, elsewhere, 'Settings copied.')
  const meta = (id: string, parent: string | null, source: unknown, extra: Record<string, unknown> = {}) => ({
    type: 'session_meta', timestamp: iso(70), payload: { id, timestamp: iso(70), cwd: folder, ...(parent ? { parent_thread_id: parent, source } : { source: 'vscode' }), ...extra }
  })
  const event = (minutes: number, payload: Record<string, unknown>) => ({ type: 'event_msg', timestamp: iso(minutes), payload })
  rollout(sandbox, CODEX_ROOT, [meta(CODEX_ROOT, null, null), { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Import the trial server' }] } }], 5)
  writeFileSync(join(sandbox.codexHome, 'session_index.jsonl'), lines({ id: CODEX_ROOT, thread_name: 'Trial server import' }))
  rollout(sandbox, CODEX_SPAWN, [
    meta(CODEX_SPAWN, CODEX_ROOT, { subagent: { thread_spawn: { parent_thread_id: CODEX_ROOT, depth: 1, agent_nickname: 'Hubble' } } }),
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Write the migration test' }] } },
    event(40, { type: 'task_started' }),
    event(35, { type: 'turn_aborted', reason: 'interrupted' })
  ], 35)
  rollout(sandbox, CODEX_GUARD, [
    meta(CODEX_GUARD, CODEX_ROOT, { subagent: { other: 'guardian' } }, { thread_source: 'guardian_review' }),
    event(30, { type: 'task_started' }),
    event(29, { type: 'task_complete', last_agent_message: JSON.stringify({ risk_level: 'low', outcome: 'allow', rationale: 'Only runs the migration script.' }) })
  ], 29)
}

const bars = (page: Page) => page.locator('.bg-item')
const openAgents = async (page: Page): Promise<void> => {
  await page.locator('#background-button').click()
  await expect(page.locator('.bg-view')).toBeVisible()
}
// A group with only finished agents starts folded, so tests that count every row open them all first.
const openAgentsExpanded = async (page: Page): Promise<void> => {
  await openAgents(page)
  await expect(page.locator('.bg-group')).not.toHaveCount(0)
  if (await page.locator('#bg-expand-all').isEnabled()) await page.locator('#bg-expand-all').click()
  await expect(page.locator('.bg-group-toggle[aria-expanded="false"]')).toHaveCount(0)
}

async function pick(page: Page, trigger: string, option: string): Promise<void> {
  await page.locator(trigger).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('Agents tab sits after Sessions, shows the running count and agents grouped by session', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    const ids = await page.locator('.topbar-nav > button').evaluateAll((nodes) => nodes.map((node) => node.id))
    expect(ids.slice(0, 3)).toEqual(['sessions-button', 'background-button', 'files-button'])
    await expect(page.locator('#background-button .count-badge')).toHaveText('1', { timeout: 15_000 })
    await expect(page.locator('#background-button')).toHaveAccessibleName('Agents, 1 running')
    await openAgentsExpanded(page)
    await expect(page.locator('#background-button')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.bg-group')).toHaveCount(3)
    await expect(bars(page)).toHaveCount(6)
    const first = page.locator('.bg-group').first()
    await expect(first.locator('.bg-group-title')).toHaveText('Release polish')
    await expect(first.locator('.bg-group-project')).toHaveText('Smoke')
    await expect(first.locator('.bg-group-counts')).toHaveText('4 agents · 1 running · 3 done')
    await expect(first.locator('.bg-item').first()).toHaveAttribute('data-status', 'running')
    await expect(page.locator('.bg-track, .bg-fill, .bg-dot')).toHaveCount(0)
    await expect(first.locator('.bg-item').first().locator('.bg-item-time')).toHaveText(/^[0-9]+[smh]/)
    const radius = await page.locator('#bg-status-running').evaluate((node) => getComputedStyle(node).borderRadius)
    expect(parseFloat(radius)).toBeLessThanOrEqual(6)
    await expect(page.locator('#bg-status-running')).toHaveCSS('border-top-width', '0px')
    await page.setViewportSize({ width: 1024, height: 728 })
    await expect(first.locator('.bg-item-name').first()).toBeVisible()
    await expect(page.locator('#bg-status-running')).toHaveText('1 running')
    await expect(page.locator('#bg-status-done')).toHaveText('4 done')
    await expect(page.locator('#bg-status-failed')).toHaveText('1 failed')
    await expect(page.locator('.bg-item.st-running')).toHaveAccessibleName(/Option A grid pass, general-purpose, running/)
    await expect(page.locator('#bg-totals')).toContainText('tokens')
    await expect(page.locator('.bg-axis, .bg-now, .bg-grid')).toHaveCount(0)
    await page.keyboard.press('Control+Shift+L')
    await expect(page.locator('.bg-view')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('every filter narrows the list and Clear filters resets them', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await openAgentsExpanded(page)
    await expect(bars(page)).toHaveCount(6)
    await expect(page.locator('#bg-clear')).toBeHidden()

    await page.locator('#bg-status-failed').click()
    await expect(bars(page)).toHaveCount(1)
    await expect(bars(page).first()).toHaveAccessibleName(/Write the migration test, spawn_agent, failed/)
    await page.locator('#bg-status-failed').click()
    await expect(bars(page)).toHaveCount(6)

    await page.locator('#bg-kind-codex').click()
    await expect(bars(page)).toHaveCount(1)
    await page.locator('#bg-kind-codex').click()
    await page.locator('#bg-kind-claude').click()
    await expect(bars(page)).toHaveCount(5)
    await page.locator('#bg-kind-claude').click()

    await pick(page, '#bg-project-filter-trigger', 'Other folders')
    await expect(bars(page)).toHaveCount(1)
    await expect(bars(page).first()).toHaveAccessibleName(/Copy tenant settings/)
    await pick(page, '#bg-project-filter-trigger', 'Smoke')
    await expect(bars(page)).toHaveCount(5)
    await pick(page, '#bg-project-filter-trigger', 'All projects')

    await pick(page, '#bg-range-trigger', 'Last 2 hours')
    await expect(bars(page)).toHaveCount(5)
    await pick(page, '#bg-range-trigger', 'Last hour')
    await expect(bars(page)).toHaveCount(4)
    await pick(page, '#bg-range-trigger', 'Last 7 days')
    await expect(bars(page)).toHaveCount(6)
    await pick(page, '#bg-range-trigger', 'Last 24 hours')
    await expect(bars(page)).toHaveCount(6)

    await page.locator('#bg-search').fill('trial server')
    await expect(bars(page)).toHaveCount(1)
    await page.locator('#bg-search').fill('explore')
    await expect(bars(page)).toHaveCount(2)
    await page.locator('#bg-search').fill('sidebar')
    await expect(bars(page)).toHaveCount(1)
    await page.locator('#bg-search').fill('')

    await expect(bars(page)).toHaveCount(6)
    await page.locator('#bg-automatic').check()
    await expect(bars(page)).toHaveCount(7)
    await expect(page.locator('.bg-item.auto')).toHaveCount(1)
    await expect(page.locator('.bg-item.auto')).toHaveAccessibleName(/Safety review · allow, automatic review, done/)
    await expect(page.locator('#bg-clear')).toBeVisible()
    await page.locator('#bg-clear').click()
    await expect(bars(page)).toHaveCount(6)
    await expect(page.locator('#bg-automatic')).not.toBeChecked()
    await expect(page.locator('#bg-clear')).toBeHidden()
  } finally {
    await closeApp(app)
  }
})

test('details panel shows the agent and Copy result, Show file and Go to session work', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await openAgentsExpanded(page)
    await page.locator('.bg-item', { hasText: 'Sidebar session features' }).focus()
    await page.keyboard.press('Enter')
    const details = page.locator('#bg-details')
    await expect(details).toBeVisible()
    await expect(details).toContainText('Sidebar session features')
    await expect(details).toContainText('Release polish')
    await expect(details).toContainText('Sonnet')
    await expect(details).toContainText('general-purpose')
    await expect(page.locator('#bg-detail-status')).toHaveText(/done$/)
    await expect(page.locator('#bg-detail-result')).toHaveText(RESULT)

    const before = await page.locator('.bg-item:focus').getAttribute('data-key')
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.bg-item:focus')).toHaveCount(1)
    expect(await page.locator('.bg-item:focus').getAttribute('data-key')).not.toBe(before)

    await page.locator('#bg-copy').click()
    await expect(page.locator('.toast.info')).toContainText('Result copied')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(RESULT)

    await page.locator('#bg-show-file').click()
    await expect(page.locator('.toast.error')).toHaveCount(0)

    await page.locator('#bg-go').click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 15_000 })
    await expect(page.locator('#sessions-button')).toHaveAttribute('aria-pressed', 'true')

    await openAgentsExpanded(page)
    await page.locator('.bg-item', { hasText: 'Copy tenant settings' }).click()
    await expect(page.locator('#bg-go')).toBeDisabled()
    await page.locator('#bg-details-close').click()
    await expect(page.locator('#bg-details')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('groups with running or failed agents open, finished-only groups fold to one line, and the choice is remembered', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  const first = await launchApp(sandbox)
  try {
    const { page } = first
    await openAgents(page)
    const toggle = (title: string) => page.locator('.bg-group-toggle', { hasText: title })
    await expect(page.locator('.bg-group')).toHaveCount(3)
    await expect(toggle('Release polish')).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle('Trial server import')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.bg-group-toggle[aria-expanded="false"]')).toHaveCount(1)
    await expect(bars(page)).toHaveCount(5)
    const folded = page.locator('.bg-group', { has: page.locator('.bg-group-toggle[aria-expanded="false"]') })
    await expect(folded.locator('.bg-group-counts')).toHaveText('1 agent · 1 done')
    await expect(folded.locator('.bg-item')).toHaveCount(0)
    await expect(page.locator('.bg-group', { hasText: 'Trial server import' }).locator('.bg-group-counts .bg-needs')).toHaveText('1 failed')
    const chevron = await toggle('Release polish').locator('.bg-chevron').boundingBox()
    expect(chevron?.width).toBe(24)
    expect(chevron?.height).toBe(24)
    await expect(page.locator('#bg-expand-all')).toBeEnabled()
    await expect(page.locator('#bg-collapse-all')).toBeEnabled()

    await folded.locator('.bg-group-toggle').click()
    await expect(page.locator('.bg-group-toggle[aria-expanded="false"]')).toHaveCount(0)
    await expect(bars(page)).toHaveCount(6)
    await toggle('Release polish').click()
    await expect(toggle('Release polish')).toHaveAttribute('aria-expanded', 'false')
    await expect(bars(page)).toHaveCount(2)

    await page.locator('#bg-collapse-all').click()
    await expect(page.locator('.bg-group-toggle[aria-expanded="true"]')).toHaveCount(0)
    await expect(page.locator('#bg-collapse-all')).toBeDisabled()
    await page.locator('#bg-expand-all').click()
    await expect(page.locator('.bg-group-toggle[aria-expanded="false"]')).toHaveCount(0)
    await expect(bars(page)).toHaveCount(6)
    await expect(page.locator('#bg-expand-all')).toBeDisabled()
    await toggle('Release polish').click()
    await expect(toggle('Release polish')).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(() => readSettings(sandbox.userData).agentFolds?.[`claude:${PARENT}`]).toBe(false)
  } finally {
    await closeApp(first.app)
  }
  const second = await launchApp(sandbox)
  try {
    await openAgents(second.page)
    await expect(second.page.locator('.bg-group-toggle', { hasText: 'Release polish' })).toHaveAttribute('aria-expanded', 'false')
    await expect(second.page.locator('.bg-group-toggle', { hasText: 'Trial server import' })).toHaveAttribute('aria-expanded', 'true')
    await expect(second.page.locator('.bg-group-toggle[aria-expanded="false"]')).toHaveCount(1)
  } finally {
    await closeApp(second.app)
  }
})

test('Left and Right fold a focused group, Up and Down walk headers and rows, and filtering keeps the folds', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await openAgents(page)
    const head = page.locator('.bg-group-toggle', { hasText: 'Release polish' })
    await head.focus()
    await expect(head).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(head).toHaveAttribute('aria-expanded', 'false')
    await expect(head).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(head).toHaveAttribute('aria-expanded', 'true')
    await expect(head).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.bg-item').first()).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(head).toBeFocused()
    await expect(head).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Enter')
    await expect(head).toHaveAttribute('aria-expanded', 'false')
    await expect(head).toBeFocused()
    await page.keyboard.press('Space')
    await expect(head).toHaveAttribute('aria-expanded', 'true')

    const row = page.locator('.bg-item', { hasText: 'Handoff export' })
    await row.focus()
    await page.locator('#bg-status-done').click()
    await page.locator('#bg-status-done').click()
    await row.focus()
    await expect(row).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(head).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(head).toHaveAttribute('aria-expanded', 'false')
    await page.locator('#bg-search').fill('migration')
    await page.locator('#bg-search').fill('')
    await expect(head).toHaveAttribute('aria-expanded', 'false')
  } finally {
    await closeApp(app)
  }
})

test('empty states follow the range and the filters', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openAgents(page)
    await expect(page.locator('#bg-empty')).toContainText('No background agents in the last 24 hours')
    await expect(page.locator('#bg-empty')).toContainText('Claude Code or Codex session starts agents')
    await pick(page, '#bg-range-trigger', 'Last hour')
    await expect(page.locator('#bg-empty')).toContainText('No background agents in the last hour')
  } finally {
    await closeApp(app)
  }
  const seeded = createSandbox()
  seed(seeded)
  const second = await launchApp(seeded)
  try {
    await openAgentsExpanded(second.page)
    await second.page.locator('#bg-search').fill('zzzz-nothing')
    await expect(second.page.locator('#bg-nomatch')).toContainText('No agents match these filters')
    await second.page.locator('#bg-empty-clear').click()
    await expect(bars(second.page)).toHaveCount(6)
  } finally {
    await closeApp(second.app)
  }
})

for (const [mode, themeId] of [['dark', undefined], ['light', 'dawsha-daylight']] as const) {
  test(`compact groups keep summaries and controls visible, with distinct readable status colours (${mode})`, async () => {
    const sandbox = createSandbox()
    seed(sandbox)
    const settings = JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))
    if (themeId) settings.theme = { id: themeId }
    writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify(settings))
    const { app, page } = await launchApp(sandbox)
    try {
      await page.setViewportSize({ width: 1024, height: 728 })
      await openAgentsExpanded(page)
      await page.locator('#bg-collapse-all').click()
      for (const group of await page.locator('.bg-group-toggle').all()) {
        const title = await group.locator('.bg-group-title').boundingBox()
        const summary = await group.locator('.bg-group-counts').boundingBox()
        expect(title).not.toBeNull()
        expect(summary).not.toBeNull()
        expect(Math.abs(summary!.x - title!.x)).toBeLessThan(200)
        expect((await group.boundingBox())!.height).toBeLessThanOrEqual(64)
      }
      await expect(page.locator('#bg-expand-all')).toBeVisible()
      await expect(page.locator('#bg-collapse-all')).toBeVisible()
      const colours = await page.evaluate(() => {
        const hex = (value: string): string => '#' + (value.match(/[\d.]+/g) ?? []).slice(0, 3).map((part) => Math.round(Number(part)).toString(16).padStart(2, '0')).join('')
        const read = (selector: string): string => hex(getComputedStyle(document.querySelector(selector)!).color)
        return { running: read('#bg-status-running'), done: read('#bg-status-done'), failed: read('#bg-status-failed'), background: hex(getComputedStyle(document.querySelector('.bg-view')!).backgroundColor) }
      })
      expect(new Set([colours.running, colours.done, colours.failed]).size).toBe(3)
      for (const foreground of [colours.running, colours.done, colours.failed]) expect(contrastRatio(foreground, colours.background)).toBeGreaterThanOrEqual(4.5)
      await page.screenshot({ path: join('test-results/screens', `173-agents-${mode}-compact.png`) })
    } finally {
      await closeApp(app)
    }
  })

  test(`screenshots of the Agents view (${mode})`, async () => {
    test.skip(!SHOTS, 'Set DAWSHA_SHOTS to a folder to capture screenshots')
    const sandbox = createSandbox()
    seed(sandbox)
    writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ version: 2, lastSeenVersion: APP_VERSION, projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }], ...(themeId ? { theme: { id: themeId } } : {}) }), 'utf8')
    const { app, page } = await launchApp(sandbox)
    try {
      await page.setViewportSize({ width: 1440, height: 880 })
      mkdirSync(SHOTS, { recursive: true })
      await openAgents(page)
      await page.screenshot({ path: join(SHOTS, `agents-${mode}-collapsed.png`) })
      await page.locator('#bg-expand-all').click()
      await expect(bars(page)).toHaveCount(6)
      await page.screenshot({ path: join(SHOTS, `agents-${mode}-overview.png`) })
      await page.setViewportSize({ width: 1024, height: 728 })
      await page.screenshot({ path: join(SHOTS, `agents-${mode}-ci-size.png`) })
      await page.setViewportSize({ width: 1440, height: 880 })
      await page.locator('.bg-item', { hasText: 'Sidebar session features' }).click()
      await page.locator('#bg-automatic').check()
      await page.locator('#bg-project-filter-trigger').click()
      await expect(page.getByRole('listbox')).toBeVisible()
      await page.screenshot({ path: join(SHOTS, `agents-${mode}-filters-open.png`) })
      await page.keyboard.press('Escape')
      await page.locator('#bg-status-done').click()
      await page.screenshot({ path: join(SHOTS, `agents-${mode}-filtered-details.png`) })
    } finally {
      await closeApp(app)
    }
  })
}
