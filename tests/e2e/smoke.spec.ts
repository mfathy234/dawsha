import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { QUIT_BUDGET_MS, activeTermId, bufferText, closeApp, closeBounded, createSandbox, fontSize, lastInput, launchApp, openMore, openTerminalPicker } from './helpers'

const SCREENS = 'test-results/screens'
const NEW_IN_SMOKE = /^New (Claude|Codex|Gemini) session in Smoke$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

test('cleans up safely after the app has already quit', async () => {
  const { app } = await launchApp(createSandbox())
  try {
    const exited = app.waitForEvent('close')
    await app.evaluate(({ app }) => app.quit())
    await exited
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  } finally {
    await closeBounded(app)
  }
})

test('starts the default quick-pick choice when Enter arrives before the next render', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.evaluate(() => {
      const target = document.activeElement ?? document.body
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }))
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane-header .agent-mark.claude')).toHaveCount(1)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('starts a session from the sidebar without any prompt and drives the grid', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(page.locator('.empty h2')).toHaveText('No sessions yet')

    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('[role="dialog"], [role="alertdialog"], .overlay')).toHaveCount(0)
    await expect(page.locator('.pane-title')).toHaveText('1 · Smoke')
    await expect(page.locator('.pane-fresh')).toBeVisible()
    await expect(page.locator('.pane .pane-state')).toContainText('Idle')

    const claudeId = await activeTermId(page)
    await expect.poll(() => bufferText(page, claudeId), { timeout: 20_000 }).toContain('Smoke Project')
    await page.screenshot({ path: join(SCREENS, '1-single.png') })

    await openTerminalPicker(page.locator('.pane').first())
    await page.getByRole('menuitem', { name: 'Shell' }).click()
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['claude', 'shell'])
    await expect(page.locator('.tabs [role="tab"][aria-selected="true"]')).toHaveText('shell')
    await page.screenshot({ path: join(SCREENS, '2-shell-tab.png') })

    await page.getByRole('button', { name: 'Maximize pane' }).click()
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    await expect(page.locator('.sidebar.rail')).toHaveCount(1)
    await expect(page.locator('.pane-strip')).toBeVisible()
    await page.screenshot({ path: join(SCREENS, '3-maximized.png') })
    // Esc inside a terminal goes to the agent and never leaves full mode, whatever the status says.
    const fullId = await activeTermId(page)
    await page.locator('.term-host.active .xterm-helper-textarea').focus()
    await page.keyboard.press('Escape')
    await expect.poll(() => lastInput(page, fullId)).toBe('')
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Escape')
    await expect(page.locator('.pane.maximized')).toHaveCount(0)
    await expect(page.locator('.sidebar.rail')).toHaveCount(0)

    await page.keyboard.press('Control+Enter')
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    await page.getByRole('button', { name: 'Restore pane to grid' }).click()
    await expect(page.locator('.pane.maximized')).toHaveCount(0)

    const shellId = await activeTermId(page)
    expect(await fontSize(page, shellId)).toBe(15)
    await page.keyboard.press('Control+=')
    await expect.poll(() => fontSize(page, shellId)).toBe(16)
    await page.keyboard.press('Control+-')
    await page.keyboard.press('Control+-')
    await expect.poll(() => fontSize(page, shellId)).toBe(14)
    await page.keyboard.press('Control+0')
    await expect.poll(() => fontSize(page, shellId)).toBe(15)

    const host = page.locator('.term-host.active')
    const before = await host.evaluate((el) => getComputedStyle(el).backgroundColor)
    await page.locator('#settings-button').click()
    await page.locator('#settings-tab-appearance').click()
    await page.locator('#settings-theme-picker').click()
    await page.getByRole('radio', { name: /Nord/ }).click()
    await expect.poll(() => host.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(before)
    await expect(host).toHaveAttribute('data-term-background', '#262b35')
    await expect(page.locator('.note')).toHaveCount(0)
    await page.getByRole('radio', { name: /GitHub Light/ }).click()
    await expect(page.locator('.note')).toContainText('run /theme and pick light')
    await page.screenshot({ path: join(SCREENS, '4-light-theme.png') })
    // Daylight has a light terminal by default, so the light-terminal hint shows; its dark-terminal twin hides it.
    await page.locator('#theme-dawsha-daylight').click()
    await expect(page.locator('html')).toHaveAttribute('data-kind', 'light')
    await expect(host).toHaveAttribute('data-term-background', '#f1f4f8')
    await expect(page.locator('.note')).toContainText('run /theme and pick light')
    await page.locator('#theme-dawsha-daylight-dark').click()
    await expect(host).toHaveAttribute('data-term-background', '#16191f')
    await expect(page.locator('.note')).toHaveCount(0)
    await page.locator('#theme-grid-dark').click()
    await expect(page.locator('html')).toHaveAttribute('data-kind', 'dark')
    await page.keyboard.press('Escape')
    await expect(page.locator('.theme-picker')).toHaveCount(0)
    await page.locator('#settings-button').click()

    // A session that is not working closes without asking (closeConfirm.spec covers a working one).
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Close pane' }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.locator('.pane')).toHaveCount(0)
    await expect(page.locator('.empty h2')).toHaveText('No sessions yet')

    await expect.poll(() => (readSettings(sandbox.userData).workspace?.panes?.length ?? -1)).toBe(0)
    expect(readSettings(sandbox.userData).theme.id).toBe('grid-dark')
  } finally {
    await closeBounded(app)
  }
})

test('opens panes from the quick pick with the keyboard and reopens them on the next start', async () => {
  const sandbox = createSandbox()
  const first = await launchApp(sandbox)
  try {
    await first.page.keyboard.press('Control+n')
    await expect(first.page.getByRole('listbox', { name: 'Start a session in' })).toBeVisible()
    await first.page.keyboard.type('smo')
    await first.page.keyboard.press('Enter')
    await expect(first.page.locator('.pane')).toHaveCount(1)
    await expect(first.page.locator('.quickpick')).toHaveCount(0)
    // Typing goes straight into the new session, not to the button that opened the pick.
    await expect(first.page.locator('.pane .term-host.active .xterm-helper-textarea')).toBeFocused()
    await first.page.keyboard.press('Control+n')
    await expect(first.page.locator('.quickpick')).toHaveCount(1)
    await first.page.keyboard.press('Enter')
    await expect(first.page.locator('.pane')).toHaveCount(2)
    await openTerminalPicker(first.page.locator('.pane').first())
    await first.page.getByRole('menuitem', { name: 'Shell' }).click()
    await expect(first.page.locator('.pane').first().locator('.tabs [role="tab"]')).toHaveCount(2)
    await first.page.screenshot({ path: join(SCREENS, '6-two-panes.png') })
    await expect.poll(() => (readSettings(sandbox.userData).workspace?.panes?.length ?? -1)).toBe(2)
  } finally {
    expect(await closeApp(first.app)).toBeLessThan(QUIT_BUDGET_MS)
  }

  const second = await launchApp(sandbox)
  try {
    await expect(second.page.locator('.pane')).toHaveCount(2)
    await expect(second.page.locator('.pane').first().locator('.tabs [role="tab"]')).toHaveCount(2)
    await second.page.screenshot({ path: join(SCREENS, '7-restored.png') })
  } finally {
    expect(await closeApp(second.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('projects view validates folders and confirms removal by name', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openMore(page, 'projects')
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
    await expect(page.locator('[data-project-id="gone"] .field-error')).toHaveText('This folder does not exist.')
    await page.screenshot({ path: join(SCREENS, '8-projects.png') })
    // The sidebar stays mounted next to the Projects view, so both filters must keep their own ids.
    const duplicateIds = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id)
      return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
    })
    expect(duplicateIds).toEqual([])

    // An empty name is the name box's error: the folder is not marked, and Escape clears it.
    const smoke = page.locator('[data-project-id="smoke"]')
    await page.getByRole('button', { name: 'More for Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await smoke.getByRole('textbox', { name: 'Name of Smoke' }).fill('')
    await page.keyboard.press('Enter')
    await expect(smoke.locator('.field-error')).toHaveText('Name cannot be empty.')
    await expect(smoke.locator('.pv-folder')).not.toHaveClass(/invalid/)
    await page.keyboard.press('Escape')
    await expect(smoke.locator('.field-error')).toBeHidden()

    await page.getByRole('button', { name: 'More for Missing' }).click()
    await page.getByRole('menuitem', { name: 'Remove Missing…' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading')).toHaveText('Remove Missing?')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('[data-project-id="gone"]')).toHaveCount(1)
    await page.getByRole('button', { name: 'More for Missing' }).click()
    await page.getByRole('menuitem', { name: 'Remove Missing…' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove Missing' }).click()
    await expect(page.locator('[data-project-id="gone"]')).toHaveCount(0)
  } finally {
    await closeBounded(app)
  }
})

test('names panes from Claude session files and lays three panes out with a tall focused pane', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const add = page.getByRole('button', { name: NEW_IN_SMOKE })
    await add.click()
    await add.click()
    await add.click()
    await expect(page.locator('.pane')).toHaveCount(3)
    const boxes = await page.locator('.pane').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()))
    expect(boxes[2].height).toBeGreaterThan(boxes[1].height * 1.8)
    expect(boxes[0].left).toBeGreaterThan(boxes[2].left)

    const now = Date.now()
    writeFileSync(
      join(sandbox.sessionsDir, 'session.json'),
      JSON.stringify({
        pid: process.pid,
        sessionId: 'abc',
        cwd: sandbox.projectFolder,
        name: 'User avatars',
        nameSource: 'user',
        status: 'busy',
        startedAt: now + 1000,
        updatedAt: now + 1000
      }),
      'utf8'
    )
    await expect(page.locator('.pane-title', { hasText: 'User avatars' })).toHaveCount(1, { timeout: 15_000 })
    await expect(page.locator('.pane-fresh:not([hidden])')).toHaveCount(2)
    // Titles are never cut off: the unnamed-session hint shrinks first.
    const clipped = await page.locator('.pane-title').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length)
    expect(clipped).toBe(0)
    await expect(page.locator('.pane-state .state-pill.state-working')).toHaveCount(1)
    await expect(page.locator('.topbar-count')).toContainText('1 working')
    await page.screenshot({ path: join(SCREENS, '9-three-panes-named.png') })
  } finally {
    await closeBounded(app)
  }
})

test('reorders panes from the move menu and the keyboard, and opens pane menus next to their button', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const add = page.getByRole('button', { name: NEW_IN_SMOKE })
    await add.click()
    await add.click()
    await add.click()
    const panes = page.locator('.pane')
    await expect(panes).toHaveCount(3, { timeout: 20_000 })
    const ids = await panes.evaluateAll((els) => els.map((el) => el.getAttribute('data-pane-id')))

    const left = panes.nth(0)
    await left.getByRole('button', { name: 'Pane actions' }).click()
    const menu = page.locator('.pane-actions-menu')
    await expect(menu).toBeVisible()
    const paneBox = (await left.boundingBox())!
    const menuBox = (await menu.boundingBox())!
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual((await page.evaluate(() => window.innerWidth)) + 1)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    await panes.nth(2).getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Move pane…' }).click()
    await expect(menu.getByRole('menuitem')).toHaveCount(3)
    await menu.getByRole('menuitem').first().click()
    await expect
      .poll(() => panes.evaluateAll((els) => els.map((el) => el.getAttribute('data-pane-id'))))
      .toEqual([ids[2], ids[0], ids[1]])

    await page.keyboard.press('Control+Shift+Alt+ArrowRight')
    await expect
      .poll(() => panes.evaluateAll((els) => els.map((el) => el.getAttribute('data-pane-id'))))
      .toEqual([ids[0], ids[2], ids[1]])

    await page.keyboard.press('Control+1')
    await expect(panes.nth(0)).toHaveClass(/focused/)
    await page.keyboard.press('Control+Tab')
    await expect(panes.nth(1)).toHaveClass(/focused/)
  } finally {
    await closeBounded(app)
  }
})

test('starts Codex from the quick-pick with Tab, shows the OpenAI mark and adds Codex tabs', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.keyboard.press('Control+n')
    await expect(page.locator('.quickpick')).toBeVisible()
    await expect(page.locator('.quickpick .popover-foot')).toContainText('Tab switches agent')
    await page.keyboard.type('smo')
    await expect(page.locator('.quickpick .option.selected .option-agent')).toHaveText(/Claude$/)
    await page.keyboard.press('Tab')
    await expect(page.locator('.quickpick .option.selected .option-agent')).toHaveText(/Codex$/)
    await page.keyboard.press('Enter')

    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.quickpick')).toHaveCount(0)
    await expect(page.locator('.pane-header .agent-mark.codex')).toHaveText('X')
    await expect(page.locator('.tabs .agent-mark.codex')).toHaveCount(1)
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['codex'])
    const codexId = await activeTermId(page)
    await expect.poll(() => bufferText(page, codexId), { timeout: 20_000 }).toContain('Smoke Project')

    await openTerminalPicker(page.locator('.pane').first())
    await page.getByRole('menuitem', { name: 'Codex session' }).click()
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['codex', 'codex 2'])
    await expect(page.locator('.tabs .agent-mark.codex')).toHaveCount(2)
    await openTerminalPicker(page.locator('.pane').first())
    await page.getByRole('menuitem', { name: 'Claude session' }).click()
    await expect(page.locator('.tabs .agent-mark.claude')).toHaveCount(1)
    await expect(page.locator('.tabs [role="tab"][aria-selected="true"]')).toHaveText('claude')
    // In the terminal, Tab and Shift+Tab go to the agent; Ctrl+PageDown/PageUp switch tabs.
    await page.locator('.term-host.active').click()
    const claudeId = await activeTermId(page)
    await page.keyboard.press('Shift+Tab')
    await expect(page.locator('.tabs [role="tab"][aria-selected="true"]')).toHaveText('claude')
    await expect.poll(() => lastInput(page, claudeId)).toBe('[Z')
    await page.keyboard.press('Control+PageUp')
    await expect(page.locator('.tabs [role="tab"][aria-selected="true"]')).toHaveText('codex 2')
    await page.keyboard.press('Control+PageDown')
    await expect(page.locator('.tabs [role="tab"][aria-selected="true"]')).toHaveText('claude')
    await expect(page.locator('.topbar-count')).toContainText('1 session')
    await page.screenshot({ path: join(SCREENS, '10-codex-tabs.png') })

    await page.keyboard.press('Control+Shift+N')
    await expect(page.locator('.quickpick .option.selected .option-agent')).toHaveText(/Codex$/)
    await page.keyboard.press('Escape')
    await expect(page.locator('.quickpick')).toHaveCount(0)
  } finally {
    await closeBounded(app)
  }
})

test('cycles Claude, Codex, Gemini with Tab, shows the Gemini mark and stores a session id per tab', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.keyboard.press('Control+n')
    await page.keyboard.type('smo')
    const agent = page.locator('.quickpick .option.selected .option-agent')
    await expect(agent).toHaveText(/Claude$/)
    await page.keyboard.press('Tab')
    await expect(agent).toHaveText(/Codex$/)
    await page.keyboard.press('Tab')
    await expect(agent).toHaveText(/Gemini$/)
    await page.keyboard.press('Tab')
    await expect(agent).toHaveText(/Claude$/)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')

    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane-header .agent-mark.gemini')).toHaveText('G')
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['gemini'])
    const first = await activeTermId(page)
    await expect.poll(() => bufferText(page, first), { timeout: 20_000 }).toContain('Smoke Project')

    await openTerminalPicker(page.locator('.pane').first())
    await page.getByRole('menuitem', { name: 'Gemini session' }).click()
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['gemini', 'gemini 2'])
    await expect(page.locator('.tabs .agent-mark.gemini')).toHaveCount(2)
    await page.screenshot({ path: join(SCREENS, '12-gemini-tabs.png') })

    await expect
      .poll(() => (readSettings(sandbox.userData).workspace?.panes?.[0]?.tabs ?? []).map((t: { sessionId?: string }) => t.sessionId))
      .toEqual([expect.stringMatching(UUID), expect.stringMatching(UUID)])
    const ids = readSettings(sandbox.userData).workspace.panes[0].tabs.map((t: { sessionId: string }) => t.sessionId)
    expect(new Set(ids).size).toBe(2)

    await page.keyboard.press('Control+Shift+N')
    await expect(page.locator('.quickpick .option.selected .option-agent')).toHaveText(/Codex$/)
    await page.keyboard.press('Escape')
  } finally {
    await closeBounded(app)
  }
})

test('project default agent is set in the Projects view and used by the sidebar', async () => {
  const sandbox = createSandbox()
  const first = await launchApp(sandbox)
  try {
    await openMore(first.page, 'projects')
    const more = first.page.getByRole('button', { name: 'More for Smoke' })
    await more.click()
    const menu = first.page.getByRole('menu', { name: 'More for Smoke' })
    await expect(menu.getByRole('menuitemradio', { name: 'Claude' })).toHaveAttribute('aria-checked', 'true')
    await expect(menu.getByRole('menuitemradio')).toHaveText([/Claude$/, /Codex$/, /Gemini$/])
    await menu.getByRole('menuitemradio', { name: 'Codex' }).click()
    await expect.poll(() => readSettings(sandbox.userData).projects[0].defaultAgent).toBe('codex')
    await more.click()
    await expect(first.page.getByRole('menuitemradio', { name: 'Codex' })).toHaveAttribute('aria-checked', 'true')
    await first.page.keyboard.press('Escape')
    await first.page.screenshot({ path: join(SCREENS, '11-default-agent.png') })

    await openMore(first.page, 'projects')
    await first.page.getByRole('button', { name: 'New Codex session in Smoke' }).click()
    await expect(first.page.locator('.pane-header .agent-mark.codex')).toHaveCount(1)
    await first.page.getByRole('button', { name: 'Project actions for Smoke' }).click()
    await first.page.getByRole('menuitem', { name: 'Claude session' }).click()
    await expect(first.page.locator('.pane')).toHaveCount(2)
    await expect(first.page.locator('.pane-header .agent-mark.claude')).toHaveCount(1)
    await expect(first.page.locator('.sess-row .agent-mark')).toHaveCount(2)
    const collapseSessions = first.page.getByRole('button', { name: 'Hide sessions for Smoke' })
    await collapseSessions.click()
    await expect(first.page.getByRole('button', { name: 'Show sessions for Smoke' })).toHaveAttribute('aria-expanded', 'false')
    await expect(first.page.locator('.sidebar .sess-row')).toHaveCount(0)
    await first.page.getByRole('button', { name: 'Show sessions for Smoke' }).click()
    await expect(first.page.locator('.sidebar .sess-row')).toHaveCount(2)
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.length ?? -1).toBe(2)
    expect(readSettings(sandbox.userData).workspace.panes[0].tabs[0].agent).toBe('codex')
  } finally {
    expect(await closeApp(first.app)).toBeLessThan(QUIT_BUDGET_MS)
  }

  const second = await launchApp(sandbox)
  try {
    await expect(second.page.locator('.pane')).toHaveCount(2)
    await expect(second.page.locator('.pane-header .agent-mark.codex')).toHaveCount(1)
    await expect(second.page.locator('.pane-header .agent-mark.claude')).toHaveCount(1)
  } finally {
    expect(await closeApp(second.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('names and status of a Codex pane come from Codex rollout files', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.keyboard.press('Control+Shift+N')
    await expect(page.locator('.quickpick .option.selected .option-agent')).toHaveText(/Codex$/)
    await page.keyboard.type('smo')
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane-header .agent-mark.codex')).toHaveCount(1)
    await expect(page.locator('.pane-fresh')).toBeVisible()

    const id = '019aaaaa-0000-7000-8000-0000000000aa'
    const dir = join(sandbox.codexHome, 'sessions', '2026', '10', '08')
    mkdirSync(dir, { recursive: true })
    const meta = {
      type: 'session_meta',
      payload: { id, cwd: sandbox.projectFolder, timestamp: new Date(Date.now() + 1000).toISOString() }
    }
    const started = { type: 'event_msg', payload: { type: 'task_started' } }
    writeFileSync(
      join(dir, `rollout-2026-10-08T12-00-00-${id}.jsonl`),
      [meta, started].map((line) => JSON.stringify(line)).join('\n') + '\n',
      'utf8'
    )
    writeFileSync(
      join(sandbox.codexHome, 'session_index.jsonl'),
      JSON.stringify({ id, thread_name: 'Fix the invoice report', updated_at: new Date().toISOString() }) + '\n',
      'utf8'
    )
    await expect(page.locator('.pane-title', { hasText: 'Fix the invoice report' })).toHaveCount(1, { timeout: 15_000 })
    await expect(page.locator('.pane-state .state-pill.state-working')).toHaveCount(1)
    await expect(page.locator('.topbar-count')).toContainText('1 working')
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.[0]?.tabs?.[0]?.sessionId).toBe(id)
  } finally {
    await closeBounded(app)
  }
})
