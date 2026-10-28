import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, closeApp, closeSettings, createSandbox, feedTerminal, launchApp, openMore, openSettings, type Sandbox } from './helpers'

const SCREENS = 'test-results/screens'
const SHOTS = process.env.DAWSHA_SHOTS ?? ''
const NEW_IN_SMOKE = /^New (Claude|Codex|Gemini) session in Smoke$/
const PROMPT = ['  npm run migrate -- --env dev', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')
const fixture = readFileSync(join(__dirname, '../unit/fixtures/statusline-payload.json'), 'utf8')
const THEMES = [
  ['dark', undefined],
  ['light', 'dawsha-daylight']
] as const

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENS, { recursive: true })
  await page.screenshot({ path: join(SCREENS, `171-a-${name}.png`) })
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: join(SHOTS, `171-a-${name}.png`) })
  }
}

function withTheme(sandbox: Sandbox, themeId: string | undefined, extra: Record<string, unknown> = {}): void {
  const settings = { version: 2, lastSeenVersion: APP_VERSION, projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }], ...(themeId ? { theme: { id: themeId } } : {}), ...extra }
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify(settings), 'utf8')
}

const cssVar = (page: Page, name: string): Promise<string> => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

const style = (page: Page, selector: string, props: string[]): Promise<Record<string, string>> =>
  page.locator(selector).first().evaluate((el, list) => {
    const cs = getComputedStyle(el)
    return Object.fromEntries(list.map((p) => [p, cs.getPropertyValue(p)]))
  }, props)

const rgb = (hex: string): string => {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

async function openThreePanes(page: Page): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(index + 1, { timeout: 20_000 })
  }
}

async function needsYou(page: Page, index: number): Promise<void> {
  const pane = page.locator('.pane').nth(index)
  const termId = (await pane.locator('.term-host').first().getAttribute('data-term-id')) ?? ''
  await expect(async () => {
    await feedTerminal(page, termId, '\r\n' + PROMPT)
    await expect(pane).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
  }).toPass({ timeout: 30_000 })
}

test('the surface ladder: dark tokens and the plane colours that paint', async () => {
  const sandbox = createSandbox()
  withTheme(sandbox, undefined)
  const { app, page } = await launchApp(sandbox)
  try {
    expect(await cssVar(page, '--canvas')).toBe('#07090c')
    expect(await cssVar(page, '--chrome')).toBe('#0f1217')
    expect(await cssVar(page, '--pane')).toBe('#161a22')
    expect(await cssVar(page, '--raised')).toBe('#1d222c')
    expect(await cssVar(page, '--overlay')).toBe('#252b37')
    expect(await cssVar(page, '--well')).toBe('#0d1015')
    expect((await style(page, '.topbar', ['background-color']))['background-color']).toBe(rgb('#0f1217'))
    expect((await style(page, '.sidebar', ['background-color']))['background-color']).toBe(rgb('#0f1217'))
    expect((await style(page, 'body', ['background-color']))['background-color']).toBe(rgb('#07090c'))
  } finally {
    await closeApp(app)
  }
})

test('nav: Sessions, Agents, Files and More, the rest live under More', async () => {
  const sandbox = createSandbox()
  withTheme(sandbox, undefined, { experimental: { orchestrator: true } })
  const { app, page } = await launchApp(sandbox)
  try {
    const labels = await page.locator('.topbar-nav .btn').allTextContents()
    expect(labels.map((text) => text.replace(/\s+/g, ' ').trim())).toEqual(['Sessions', 'Agents', 'Files', 'More'])
    await page.locator('#more-button').click()
    const items = await page.locator('.more-item').allTextContents()
    expect(items.map((text) => text.replace(/\s+/g, ' ').trim())).toEqual(expect.arrayContaining(['Projects', 'Usage', 'Work', 'Orchestrator', 'Agent tools', 'Skills', 'Layouts']))
    await page.keyboard.press('Escape')
    await openMore(page, 'usage')
    await expect(page.locator('#more-button')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#more-button .more-text')).toHaveText('More')
    await page.locator('#sessions-button').click()
    await page.mouse.move(700, 500)
    await expect.poll(async () => (await style(page, '#sessions-button', ['background-color']))['background-color']).toBe(rgb('#1d222c'))
    const active = await style(page, '#sessions-button', ['font-weight', 'border-bottom-style', 'outline-style'])
    expect(Number(active['font-weight'])).toBe(600)
    expect(active['border-bottom-style']).toBe('none')
    expect(active['outline-style']).toBe('none')
  } finally {
    await closeApp(app)
  }
})

test('focus rings follow the keyboard: none on the nav after a mouse click, visible after Tab', async () => {
  const sandbox = createSandbox()
  withTheme(sandbox, undefined)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#background-button').click()
    await page.locator('#sessions-button').click()
    const sessions = page.locator('#sessions-button')
    await expect(sessions).toHaveAttribute('aria-pressed', 'true')
    const clicked = await style(page, '#sessions-button', ['outline-style', 'box-shadow'])
    expect(clicked['outline-style']).toBe('none')
    expect(clicked['box-shadow']).not.toContain(rgb('#34d399'))
    // a keyboard ring left on the button must not survive the next mouse press
    await sessions.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.input)).toBe('keyboard')
    await sessions.click()
    expect((await style(page, '#sessions-button', ['outline-style']))['outline-style']).toBe('none')
    // keyboard use brings the ring back
    await page.keyboard.press('Tab')
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('background-button')
    const ring = await style(page, '#background-button', ['outline-style', 'outline-width'])
    expect(ring['outline-style']).toBe('solid')
    expect(ring['outline-width']).toBe('2px')
  } finally {
    await closeApp(app)
  }
})

for (const [mode, themeId] of THEMES) {
  test(`${mode}: focused pane ring, needs-you solid ring with the word, dimmed unfocused well`, async () => {
    test.setTimeout(120_000)
    const sandbox = createSandbox()
    withTheme(sandbox, themeId)
    const { app, page } = await launchApp(sandbox)
    try {
      await openThreePanes(page)
      await needsYou(page, 0)
      await page.locator('.pane').nth(2).locator('.pane-title').click()
      await page.mouse.move(700, 500)
      const needs = page.locator('.pane').nth(0)
      const focused = page.locator('.pane').nth(2)
      const idle = page.locator('.pane').nth(1)
      await expect(focused).toHaveClass(/focused/)

      const ring = await focused.evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, outline: getComputedStyle(el).outlineStyle }))
      expect(ring.outline).toBe('none')
      expect(ring.shadow).toContain(mode === 'dark' ? 'rgba(255, 255, 255, 0.24) 0px 0px 0px 1px' : 'rgba(24, 28, 40, 0.32) 0px 0px 0px 1px')
      const needsRing = await needs.evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, outline: getComputedStyle(el).outlineStyle }))
      expect(needsRing.outline).toBe('none')
      expect(needsRing.shadow).toContain(`${rgb(mode === 'dark' ? '#f08a3c' : '#c2620a')} 0px 0px 0px 1px`)
      await expect(needs.locator('.pane-header .state-pill-text')).toHaveText('Needs you')
      expect(await idle.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none')
      expect(await idle.evaluate((el) => getComputedStyle(el).boxShadow)).not.toContain('0.24')

      const header = await focused.locator('.pane-header').evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(header).toBe(rgb(mode === 'dark' ? '#1d222c' : '#ffffff'))
      expect(await focused.locator('.pane-title').evaluate((el) => getComputedStyle(el).fontWeight)).toBe('700')
      expect(await idle.locator('.pane-title').evaluate((el) => getComputedStyle(el).fontWeight)).toBe('600')
      expect(await focused.locator('.pane-title').evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none')

      const body = await focused.locator('.pane-body').evaluate((el) => ({ margin: getComputedStyle(el).marginLeft, radius: getComputedStyle(el).borderTopLeftRadius, bg: getComputedStyle(el).backgroundColor, seam: getComputedStyle(el).borderTopWidth }))
      expect(body.margin).toBe('0px')
      expect(body.radius).toBe('0px')
      expect(body.seam).toBe('1px')
      expect(body.bg).toBe(rgb(mode === 'dark' ? '#0d1015' : '#f6f8f7'))
      expect(await idle.locator('.pane-body').evaluate((el) => getComputedStyle(el, '::after').content)).toBe('none')
      expect(await idle.locator('.xterm-screen').first().evaluate((el) => getComputedStyle(el).opacity)).toBe(mode === 'dark' ? '0.86' : '0.9')
      expect(await focused.locator('.xterm-screen').first().evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
      expect(await idle.locator('.pane-body').evaluate((el) => getComputedStyle(el).filter)).toBe('none')
      expect(await focused.locator('.pane-body').evaluate((el) => getComputedStyle(el).filter)).toBe('none')

      await shot(page, `${mode}-grid`)
    } finally {
      await closeApp(app)
    }
  })
}

test('light theme: the terminal is light by default, dark stays a theme choice', async () => {
  const sandbox = createSandbox()
  withTheme(sandbox, 'dawsha-daylight')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).first().click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    await expect(page.locator('.term-host.active')).toHaveAttribute('data-term-background', '#f6f8f7')
    expect(await page.locator('.term-host.active').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb('#f6f8f7'))
    await page.getByRole('button', { name: 'Theme' }).click()
    await page.getByRole('radio', { name: /Daylight, dark terminal/ }).click()
    await expect(page.locator('.term-host.active')).toHaveAttribute('data-term-background', '#16191f')
  } finally {
    await closeApp(app)
  }
})

function statusFiles(sandbox: Sandbox, fiveHour: number, week: number): void {
  const sessionId = 'sess-structure-1'
  const now = Date.now()
  writeFileSync(join(sandbox.sessionsDir, `${sessionId}.json`), JSON.stringify({ pid: process.pid, sessionId, cwd: sandbox.projectFolder, name: 'Structure', nameSource: 'user', status: 'idle', startedAt: now + 1000, updatedAt: now + 1000 }), 'utf8')
  const dir = join(sandbox.userData, 'status')
  mkdirSync(dir, { recursive: true })
  const payload = {
    ...JSON.parse(fixture),
    session_id: sessionId,
    rate_limits: {
      five_hour: { used_percentage: fiveHour, resets_at: Math.floor((Date.now() + 5 * 3_600_000) / 1000) },
      seven_day: { used_percentage: week, resets_at: Math.floor((Date.now() + 4 * 86_400_000) / 1000) }
    }
  }
  writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify(payload), 'utf8')
}

test('batteries: a gauge per limit with its stage, and the percent takes the stage colour from amber up', async () => {
  const sandbox = createSandbox()
  withTheme(sandbox, undefined)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).first().click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    await openSettings(page, 'notifications')
    await page.locator('#bridge-toggle').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Edit ~/.claude/settings.json' }).click()
    await expect(page.locator('#bridge-toggle')).toBeChecked()
    await closeSettings(page)
    statusFiles(sandbox, 38, 74)
    await expect(page.locator('[data-limit="five_hour"]')).toContainText('38%', { timeout: 15_000 })
    const five = page.locator('[data-limit="five_hour"]')
    const week = page.locator('[data-limit="seven_day"]')
    await expect(five).toHaveClass(/stage-ok/)
    await expect(week).toHaveClass(/stage-warn/)
    await expect(page.locator('.topbar-limits .charge')).toHaveCount(2)
    await expect(five.locator('.charge i')).toHaveCount(5)
    await expect(five.locator('.charge i.on')).toHaveCount(2)
    await expect(week.locator('.charge i.on')).toHaveCount(4)
    const cell = await five.locator('.charge i').first().evaluate((el) => ({ w: getComputedStyle(el).width, h: getComputedStyle(el).height }))
    expect(cell).toEqual({ w: '6px', h: '10px' })
    expect(await week.locator('.charge i.on').first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb('#f5b54a'))
    expect(await week.locator('.limit-value').evaluate((el) => getComputedStyle(el).color)).toBe(rgb('#f5b54a'))
    expect(await five.locator('.limit-value').evaluate((el) => getComputedStyle(el).color)).not.toBe(rgb('#f5b54a'))
    await shot(page, 'dark-topbar-batteries')
    statusFiles(sandbox, 85, 93)
    await expect(five).toHaveClass(/stage-high/, { timeout: 15_000 })
    await expect(week).toHaveClass(/stage-critical/)
  } finally {
    await closeApp(app)
  }
})

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, stdio: 'ignore' })
}
const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n')
const iso = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString()
const slug = (folder: string): string => folder.replace(/[^A-Za-z0-9]/g, '-')

function seedRepoAndAgents(sandbox: Sandbox): void {
  const repo = sandbox.projectFolder
  mkdirSync(join(repo, 'src'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'src', 'theme.ts'), 'export type Theme = "light" | "dark"\n\nexport function readStored(): Theme {\n  return "dark"\n}\n')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  const parent = '4d1b16b0-2a58-42e8-a971-0fadf4e0f3e4'
  const dir = join(sandbox.claudeHome, 'projects', slug(repo))
  mkdirSync(join(dir, parent, 'subagents'), { recursive: true })
  writeFileSync(join(dir, `${parent}.jsonl`), lines({ type: 'user', timestamp: iso(90), cwd: repo, message: { content: 'Polish the release' } }, { type: 'ai-title', aiTitle: 'Release polish' }))
  const agent = (id: string, description: string, age: number, final: string | null): void => {
    const base = join(dir, parent, 'subagents', `agent-${id}`)
    writeFileSync(`${base}.meta.json`, JSON.stringify({ agentType: 'general-purpose', spawnDepth: 1, requestShape: 'background', model: 'sonnet', description, ...(final ? { finished: true } : {}) }))
    const first = { type: 'user', timestamp: iso(age + 20), cwd: repo, isSidechain: true, message: { role: 'user', content: 'Go' } }
    const usage = { input_tokens: 10, output_tokens: 20 }
    const last = final
      ? { type: 'assistant', timestamp: iso(age), message: { id: `m-${id}`, model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage, content: [{ type: 'text', text: final }] } }
      : { type: 'assistant', timestamp: iso(age), message: { id: `m-${id}`, model: 'claude-sonnet-5-5', stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }
    writeFileSync(`${base}.jsonl`, lines(first, last))
    utimesSync(`${base}.jsonl`, new Date(Date.now() - age * 60_000), new Date(Date.now() - age * 60_000))
  }
  agent('run1', 'Option A grid pass', 0.3, null)
  agent('done1', 'Sidebar session features', 20, 'Rebased the branch and all 14 tests pass.')
  agent('done2', 'Handoff export', 75, 'Found the export code in handoff.ts.')
}

for (const [mode, themeId] of THEMES) {
  test(`${mode}: board, settings, Files, Agents and a menu`, async () => {
    test.setTimeout(120_000)
    const sandbox = createSandbox()
    withTheme(sandbox, themeId)
    seedRepoAndAgents(sandbox)
    const { app, page } = await launchApp(sandbox)
    try {
      await openThreePanes(page)
      await needsYou(page, 0)
      await page.locator('#layout-board').click()
      await expect(page.locator('.board-view')).toBeVisible()
      const card = page.locator('.board-card.attention').first()
      await expect(card).toBeVisible()
      expect(await card.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('dashed')
      expect(await page.locator('.board-col').first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
      await shot(page, `${mode}-board`)
      await page.locator('#layout-grid').click()

      await openSettings(page, 'general')
      const nav = await style(page, '.settings-nav', ['background-color'])
      expect(nav['background-color']).toBe(rgb(mode === 'dark' ? '#0f1217' : '#edf0ee'))
      expect(await page.locator('.settings-view input[type="checkbox"]').first().evaluate((el) => getComputedStyle(el).width)).toBe('30px')
      await shot(page, `${mode}-settings`)
      await page.locator('#settings-button').click()

      await page.locator('#files-button').click()
      await expect(page.locator('#files-view')).toBeVisible()
      await page.locator('.files-row[data-path="src"]').click()
      await page.locator('.files-row[data-path="src/theme.ts"]').click()
      await expect(page.locator('.files-editor:not([hidden]) .cm-content')).toContainText('readStored')
      await shot(page, `${mode}-files`)
      await page.locator('#files-button').click()

      await page.locator('#background-button').click()
      await expect(page.locator('.bg-view')).toBeVisible()
      await expect(page.locator('.bg-item').first()).toBeVisible({ timeout: 20_000 })
      await shot(page, `${mode}-agents`)
      await page.locator('#sessions-button').click()

      await page.locator('#more-button').click()
      await expect(page.locator('.more-item').first()).toBeVisible()
      await page.waitForTimeout(250)
      await shot(page, `${mode}-popover-more`)
      await page.keyboard.press('Escape')
    } finally {
      await closeApp(app)
    }
  })
}
