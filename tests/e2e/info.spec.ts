import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { activeTermId, bufferText, closeApp, closeBounded, createSandbox, feedTerminal, launchApp, openSettings, closeSettings, QUIT_BUDGET_MS, type Sandbox, openMore } from './helpers'

const SCREENS = 'test-results/screens'
const NEW_IN_SMOKE = /^New (Claude|Codex|Gemini) session in Smoke$/
const fixture = readFileSync(join(__dirname, '../unit/fixtures/statusline-payload.json'), 'utf8')

const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'))
const readLines = (path: string): any[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : []

function git(folder: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd: folder,
    stdio: 'ignore'
  })
}

function writeSession(sandbox: Sandbox, sessionId: string, status: string, name = 'Info session'): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${sessionId}.json`),
    JSON.stringify({
      pid: process.pid,
      sessionId,
      cwd: sandbox.projectFolder,
      name,
      nameSource: 'user',
      status,
      startedAt: now + 1000,
      updatedAt: now + 1000
    }),
    'utf8'
  )
}

function writeStatus(sandbox: Sandbox, sessionId: string): void {
  const dir = join(sandbox.userData, 'status')
  mkdirSync(dir, { recursive: true })
  const payload = {
    ...JSON.parse(fixture),
    session_id: sessionId,
    rate_limits: {
      five_hour: { used_percentage: 9, resets_at: Math.floor((Date.now() + 5 * 3_600_000) / 1000) },
      seven_day: { used_percentage: 54, resets_at: Math.floor((Date.now() + 4 * 86_400_000) / 1000) }
    }
  }
  writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify(payload), 'utf8')
}


test('live session info: confirmation, install, info strip, limits, git changes and restore', async () => {
  const sandbox = createSandbox()
  const previous = { type: 'command', command: 'echo previous-line' }
  writeFileSync(join(sandbox.claudeHome, 'settings.json'), JSON.stringify({ keep: 1, statusLine: previous }, null, 2), 'utf8')
  git(sandbox.projectFolder, 'init', '-q')
  writeFileSync(join(sandbox.projectFolder, 'a.txt'), 'one\n', 'utf8')
  git(sandbox.projectFolder, 'add', '.')
  git(sandbox.projectFolder, 'commit', '-q', '-m', 'init')
  writeFileSync(join(sandbox.projectFolder, 'a.txt'), 'one\ntwo\n', 'utf8')

  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane-info .info-changes')).toContainText('+1 −0 · 1 file', { timeout: 15_000 })
    await expect(page.locator('.pane-info .info-model')).toHaveCount(0)
    await expect(page.locator('.topbar-limits')).toContainText('no limits reported')

    await openSettings(page, 'notifications')
    await page.locator('#bridge-toggle').click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('~/.claude/settings.json')
    await expect(dialog).toContainText('echo previous-line')
    await expect(dialog.getByRole('button', { name: 'Edit ~/.claude/settings.json' })).toBeVisible()
    await page.screenshot({ path: join(SCREENS, '12-bridge-confirm.png') })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('#bridge-toggle')).not.toBeChecked()
    expect(readJson(join(sandbox.claudeHome, 'settings.json')).statusLine).toEqual(previous)

    await page.locator('#bridge-toggle').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Edit ~/.claude/settings.json' }).click()
    await expect(page.locator('#bridge-toggle')).toBeChecked()
    const edited = readJson(join(sandbox.claudeHome, 'settings.json'))
    expect(edited.keep).toBe(1)
    expect(edited.statusLine.command).toContain('statusline-bridge.js')
    expect(existsSync(join(sandbox.claudeHome, 'settings.json.dawsha-backup'))).toBe(true)
    await closeSettings(page)

    writeSession(sandbox, 'sess-info-1', 'idle')
    writeStatus(sandbox, 'sess-info-1')
    await expect(page.locator('.pane-info .info-model')).toHaveText('Opus 5.5', { timeout: 15_000 })
    await expect(page.locator('.pane-info .info-model')).toHaveClass(/fam-opus/)

    // Working with live info on: each status update moves "last activity", but the pill must stay put.
    // Rebuilding it restarts the spinner and made the header jitter ("Working · 2s" → "Working · 0s").
    writeSession(sandbox, 'sess-info-1', 'busy')
    const pill = page.locator('.pane .pane-state')
    await expect(pill).toContainText('Working', { timeout: 15_000 })
    await pill.locator('.state-icon').evaluate((el) => ((window as unknown as { __spinner?: Element }).__spinner = el))
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(1_200)
      writeStatus(sandbox, 'sess-info-1')
    }
    await page.waitForTimeout(1_500)
    expect(await pill.locator('.state-icon').evaluate((el) => (window as unknown as { __spinner?: Element }).__spinner === el)).toBe(true)
    await expect(pill).toHaveText('Working')
    writeSession(sandbox, 'sess-info-1', 'idle')
    await expect(page.locator('.pane-info .info-gauge')).toHaveText('7%')
    await expect(page.locator('.pane-info .info-gauge .charge')).toHaveAttribute('data-filled', '1')
    await expect(page.locator('.pane-info .info-cost')).toHaveText('$0.34')
    await expect(page.locator('.pane-info [data-pane-limit]')).toHaveCount(0)
    await expect(page.locator('.pane-info .info-age')).toContainText('ago')
    await expect(page.locator('[data-limit="five_hour"]')).toContainText('5h 9%')
    await expect(page.locator('[data-limit="seven_day"]')).toHaveText('week 54%')
    await expect(page.locator('.topbar-limits .charge')).toHaveCount(2)
    await expect(page.locator('[data-limit="five_hour"]')).toHaveClass(/stage-ok/)
    expect(await page.locator('.pane-info').evaluate((el) => el.getBoundingClientRect().height)).toBe(22)
    await page.screenshot({ path: join(SCREENS, '13-info-strip.png') })

    await openSettings(page, 'notifications')
    await page.locator('#bridge-toggle').click()
    await expect(page.locator('#bridge-toggle')).not.toBeChecked()
    expect(readJson(join(sandbox.claudeHome, 'settings.json'))).toEqual({ keep: 1, statusLine: previous })
    await closeSettings(page)
    await expect(page.locator('.pane-info .info-model')).toHaveCount(0)
    await expect(page.locator('.pane-info .info-changes')).toHaveCount(1)
    await expect(page.locator('.topbar-limits')).toContainText('no limits reported')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('settings.json that does not parse is reported inline and left untouched', async () => {
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.claudeHome, 'settings.json'), '{ "broken": ,, }', 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'notifications')
    await page.locator('#bridge-toggle').click()
    await expect(page.locator('#bridge-error')).toContainText('could not be parsed')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.locator('#bridge-toggle')).not.toBeChecked()
    expect(readFileSync(join(sandbox.claudeHome, 'settings.json'), 'utf8')).toBe('{ "broken": ,, }')
  } finally {
    await closeBounded(app)
  }
})

test('needs-you: done after busy to idle, permission prompt, notification only when unseen', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const add = page.getByRole('button', { name: NEW_IN_SMOKE })
    await add.click()
    await add.click()
    await expect(page.locator('.pane')).toHaveCount(2)
    const first = page.locator('.pane').nth(0)
    const second = page.locator('.pane').nth(1)

    writeSession(sandbox, 'sess-attn-1', 'busy')
    await expect(first.locator('.pane-state')).toContainText('Working', { timeout: 15_000 })
    writeSession(sandbox, 'sess-attn-1', 'idle')
    await expect(first).toHaveAttribute('data-attention', 'done', { timeout: 15_000 })
    await expect(first.locator('.pane-state')).toContainText('Done')
    await expect(first).toHaveAttribute('data-state', 'done')
    await expect(second).not.toHaveAttribute('data-state', 'done')
    await expect(second).toHaveAttribute('data-attention', 'none')
    await page.screenshot({ path: join(SCREENS, '14-needs-you-done.png') })
    await first.locator('.pane-title').click()
    await expect(first).toHaveAttribute('data-attention', 'none')
    await expect(first.locator('.pane-state')).not.toContainText('Done')

    const firstId = await first.locator('.term-host.active').getAttribute('data-term-id')
    await feedTerminal(page, firstId!, ['Do you want to proceed?', '1. Yes', '3. No, and tell Claude what to do differently', ''].join('\r\n'))
    await expect.poll(() => bufferText(page, firstId!), { timeout: 15_000 }).toContain('1. Yes')
    await second.locator('.pane-title').click()
    await expect(first).toHaveAttribute('data-attention', 'needs', { timeout: 15_000 })
    await expect(first.locator('.pane-state')).toContainText('Needs you')
    await page.screenshot({ path: join(SCREENS, '15-needs-you-permission.png') })
    await first.locator('.pane-title').click()
    await expect(first).toHaveAttribute('data-attention', 'none')

    await feedTerminal(page, firstId!, String.fromCharCode(27) + '[2J' + String.fromCharCode(27) + '[H')
    await expect.poll(() => bufferText(page, firstId!), { timeout: 15_000 }).not.toContain('1. Yes')
    await second.locator('.pane-title').click()
    await expect(first).toHaveAttribute('data-attention', 'none')
    const before = readLines(sandbox.notifyLog).length

    await second.getByRole('button', { name: 'Maximize pane' }).click()
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    writeSession(sandbox, 'sess-attn-1', 'busy')
    await expect(first.locator('.pane-state')).toContainText('Working', { timeout: 15_000 })
    writeSession(sandbox, 'sess-attn-1', 'idle')
    await expect.poll(() => readLines(sandbox.notifyLog).length, { timeout: 15_000 }).toBe(before + 1)
    const note = readLines(sandbox.notifyLog).at(-1)
    expect(note.title).toContain('is done')
    const targetPaneId = await first.getAttribute('data-pane-id')
    expect(note.paneId).toBe(targetPaneId)

    await openMore(page, 'usage')
    await expect(page.locator('.usage-view')).toBeVisible()
    await app.evaluate(({ BrowserWindow }, paneId) => {
      BrowserWindow.getAllWindows()[0].webContents.send('app:notify-click', paneId)
    }, targetPaneId)
    await expect(page.locator('.usage-view')).toBeHidden()
    await expect(page.locator(`.pane[data-pane-id="${targetPaneId}"]`)).toHaveClass(/maximized/)
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('turning notifications off silences them', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const add = page.getByRole('button', { name: NEW_IN_SMOKE })
    await add.click()
    await add.click()
    await openSettings(page, 'notifications')
    await page.locator('#notify-toggle').click()
    await expect(page.locator('#sound-toggle')).toBeDisabled()
    await closeSettings(page)
    await expect.poll(() => readJson(join(sandbox.userData, 'settings.json')).sessionInfo?.notifications).toBe(false)
    await page.locator('.pane').nth(1).getByRole('button', { name: 'Maximize pane' }).click()
    writeSession(sandbox, 'sess-quiet-1', 'busy')
    await expect(page.locator('.pane').nth(0).locator('.pane-state')).toContainText('Working', { timeout: 15_000 })
    writeSession(sandbox, 'sess-quiet-1', 'idle')
    await expect(page.locator('.pane').nth(0)).toHaveAttribute('data-attention', 'done', { timeout: 15_000 })
    expect(readLines(sandbox.notifyLog)).toHaveLength(0)
  } finally {
    await closeBounded(app)
  }
})

test('pane actions menu and resume menu', async () => {
  const sandbox = createSandbox()
  const slug = sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-')
  const dir = join(sandbox.claudeHome, 'projects', slug)
  mkdirSync(dir, { recursive: true })
  const claudeId = '11111111-2222-4333-8444-555555555555'
  writeFileSync(
    join(dir, `${claudeId}.jsonl`),
    [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'Refactor the invoice export' } }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Invoice export refactor' })
    ].join('\n') + '\n',
    'utf8'
  )
  const codexId = '019aaaaa-0000-7000-8000-0000000000bb'
  const codexDir = join(sandbox.codexHome, 'sessions', '2026', '10', '08')
  mkdirSync(codexDir, { recursive: true })
  writeFileSync(
    join(codexDir, `rollout-2026-10-08T12-00-00-${codexId}.jsonl`),
    JSON.stringify({ type: 'session_meta', payload: { id: codexId, cwd: sandbox.projectFolder, timestamp: '2026-10-08T12:00:00.000Z' } }) + '\n',
    'utf8'
  )
  writeFileSync(
    join(sandbox.codexHome, 'session_index.jsonl'),
    JSON.stringify({ id: codexId, thread_name: 'Codex thread title' }) + '\n',
    'utf8'
  )

  const { app, page } = await launchApp(sandbox)
  try {
    // The ⋯ button toggles its menu, and the menu stays inside the window.
    const agentMenu = page.getByRole('button', { name: 'Choose agent for Smoke' })
    await agentMenu.click()
    await expect(page.getByRole('menu')).toBeVisible()
    await agentMenu.click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await agentMenu.click()
    const menuBox = (await page.getByRole('menu').boundingBox())!
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    expect(menuBox.x).toBeGreaterThanOrEqual(0)
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width)
    await page.getByRole('menuitem', { name: 'Resume in Smoke…' }).click()
    await expect(page.locator('.resume-picker')).toBeVisible()
    await expect(page.locator('#rp-project')).toHaveValue('smoke')
    const rows = page.locator('.rp-row')
    await expect(rows).toHaveCount(2)
    await expect(page.locator('.rp-row', { hasText: 'Invoice export refactor' })).toHaveCount(1)
    await expect(page.locator('.rp-row', { hasText: 'Codex thread title' }).locator('.agent-mark.codex')).toHaveCount(1)
    await page.screenshot({ path: join(SCREENS, '16-resume-menu.png') })
    await page.locator('.rp-row', { hasText: 'Invoice export refactor' }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane-header .agent-mark.claude')).toHaveCount(1)
    await expect.poll(() => readJson(join(sandbox.userData, 'settings.json')).workspace?.panes?.[0]?.tabs?.[0]?.sessionId).toBe(claudeId)

    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Open in VS Code' }).click()
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Open in Explorer' }).click()
    await expect.poll(() => readLines(sandbox.openLog).map((l) => l.kind)).toEqual(['vscode', 'explorer'])
    expect(readLines(sandbox.openLog)[0].folder).toBe(sandbox.projectFolder)

    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Open terminal here' }).click()
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['claude', 'shell'])
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Show diff' }).click()
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['claude', 'shell', 'shell 2'])
    const diffTerm = await activeTermId(page)
    await expect.poll(() => bufferText(page, diffTerm), { timeout: 20_000 }).toContain('git diff')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('Codex panes show the model and context from the rollout and no cost', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'Choose agent for Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Codex session' }).click()
    await expect(page.locator('.pane-header .agent-mark.codex')).toHaveCount(1)
    const id = '019aaaaa-0000-7000-8000-0000000000cc'
    const dir = join(sandbox.codexHome, 'sessions', '2026', '10', '08')
    mkdirSync(dir, { recursive: true })
    const lines = [
      { type: 'session_meta', payload: { id, cwd: sandbox.projectFolder, timestamp: new Date(Date.now() + 1000).toISOString() } },
      { type: 'event_msg', payload: { type: 'task_started' } },
      { type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { total_tokens: 100000 }, model_context_window: 200000 }
        }
      }
    ]
    writeFileSync(join(dir, `rollout-2026-10-08T12-00-00-${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
    await expect(page.locator('.pane-info .info-model')).toHaveText('gpt-5.6-sol', { timeout: 15_000 })
    await expect(page.locator('.pane-info .info-model')).toHaveClass(/fam-codex/)
    await expect(page.locator('.pane-info .info-gauge')).toHaveText('50%')
    await expect(page.locator('.pane-info .info-gauge .charge')).toHaveAttribute('data-filled', '5')
    await expect(page.locator('.pane-info .info-cost')).toHaveCount(0)
    await page.screenshot({ path: join(SCREENS, '17-codex-info.png') })
  } finally {
    await closeBounded(app)
  }
})

test('Gemini panes take title and model from the chat file of their own session id and list in resume', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'Choose agent for Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Gemini session' }).click()
    await expect(page.locator('.pane-header .agent-mark.gemini')).toHaveCount(1)
    await expect(page.locator('.pane-title')).toHaveText('1 · Smoke')
    const settingsPath = join(sandbox.userData, 'settings.json')
    await expect.poll(() => readJson(settingsPath).workspace?.panes?.[0]?.tabs?.[0]?.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    const id: string = readJson(settingsPath).workspace.panes[0].tabs[0].sessionId

    const project = join(sandbox.geminiHome, 'tmp', 'smoke')
    mkdirSync(join(project, 'chats'), { recursive: true })
    writeFileSync(join(project, '.project_root'), sandbox.projectFolder, 'utf8')
    const lines = [
      { sessionId: id, projectHash: 'h', startTime: new Date().toISOString(), lastUpdated: new Date().toISOString(), kind: 'main' },
      { id: 'm1', type: 'user', content: [{ text: 'Plan the release notes' }] },
      { id: 'm2', type: 'gemini', content: 'Sure.', model: 'gemini-2.5-pro' }
    ]
    writeFileSync(join(project, 'chats', `session-2026-10-08T12-00-${id.slice(0, 8)}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
    await expect(page.locator('.pane-title')).toHaveText('1 · Plan the release notes', { timeout: 15_000 })
    await expect(page.locator('.pane-info .info-model')).toHaveText('gemini-2.5-pro')
    await expect(page.locator('.pane-info .info-model')).toHaveClass(/fam-gemini/)
    await page.screenshot({ path: join(SCREENS, '18-gemini-info.png') })

    await page.getByRole('button', { name: 'Choose agent for Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Resume in Smoke…' }).click()
    const row = page.locator('.rp-row', { hasText: 'Plan the release notes' })
    await expect(row.locator('.agent-mark.gemini')).toHaveCount(1)
  } finally {
    await closeBounded(app)
  }
})
