import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { bufferText, closeApp, closePaneViaActions, createSandbox, feedTerminal, launchApp } from './helpers'

const readSettings = (dir: string): any => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
async function openMini(app: ElectronApplication, page: Page): Promise<Page> {
  const opened = app.waitForEvent('window')
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mini window' }).click()
  const mini = await opened
  await expect(mini.locator('#mini')).toBeVisible()
  return mini
}

test('Mini lists sessions, answers through the host, opens the selected pane and keeps focus while updating', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const add = page.getByRole('button', { name: /^New (Claude|Codex|Gemini) session in Smoke$/ })
    await add.click()
    await add.click()
    await expect(page.locator('.pane')).toHaveCount(2)
    const first = page.locator('.pane').first()
    await first.getByRole('button', { name: 'Maximize pane', exact: true }).click()
    const paneId = await first.getAttribute('data-pane-id')
    const id = (await first.locator('.term-host.active').getAttribute('data-term-id'))!
    const mini = await openMini(app, page)
    await expect(mini.locator('.mini-card')).toHaveCount(2)
    await expect(mini.locator('.mini-card').first()).toHaveAttribute('data-state', 'idle')
    await expect.poll(async () => (await bufferText(page, id)).replace(/\n/g, '').trimEnd(), { timeout: 30_000 }).toMatch(/[>$#%]$/)
    const needs = mini.locator('.mini-card[data-state="needs"]')
    await expect(async () => {
      await feedTerminal(page, id, [...Array.from({ length: 32 }, (_, n) => `Output ${n}`), '● Bash(npm run migrate)', 'Do you want to proceed?', '1. Yes', '3. No, and tell Claude what to do differently', ''].join('\r\n'))
      await expect.poll(() => bufferText(page, id), { timeout: 1500 }).toContain('1. Yes')
      await expect(needs).toContainText('npm run migrate', { timeout: 1500 })
    }).toPass({ timeout: 15_000 })
    const allow = needs.getByRole('button', { name: 'Allow', exact: true })
    await allow.focus()
    await mini.waitForTimeout(600)
    await expect(allow).toBeFocused()
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const host = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha')!
      ;(globalThis as any).__miniWrites = []
      ipcMain.on('pty:write', (event, termId, text) => {
        ;(globalThis as any).__miniWrites.push({ termId, text, fromHost: event.sender === host.webContents })
      })
    })
    const prompt = await mini.evaluate(async pane => (await window.miniApi.get())!.sessions.find(s => s.paneId === pane)!.permission!.prompt, paneId!)
    await feedTerminal(page, id, '\x1b[2J\x1b[H● Bash(npm test)\r\nDo you want to proceed?\r\n1. Yes\r\n3. No\r\n')
    await expect(needs).toContainText('npm test')
    await mini.evaluate(({ paneId, prompt }) => window.miniApi.action({ kind: 'answer', paneId, allow: true, prompt }), { paneId: paneId!, prompt })
    await expect(page.locator('.toasts')).toContainText('That request changed')
    expect(await app.evaluate(() => (globalThis as any).__miniWrites)).toEqual([])
    await allow.click()
    await expect.poll(() => app.evaluate(() => (globalThis as any).__miniWrites)).toContainEqual({ termId: id, text: '\r', fromHost: true })
    await mini.locator(`.mini-card[data-pane-id="${paneId}"]`).getByRole('button', { name: 'Open in Dawsha', exact: true }).click()
    await expect(page.locator('.pane.focused')).toHaveAttribute('data-pane-id', paneId!)
    const properties = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha Mini')!
      return { alwaysOnTop: window.isAlwaysOnTop(), bounds: window.getBounds() }
    })
    expect(properties.alwaysOnTop).toBe(true)
    expect(await mini.evaluate(() => typeof window.gridApi)).toBe('undefined')
    expect(await mini.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')
    expect(properties.bounds.x).toBeLessThan(-10000)
    await mini.getByRole('button', { name: 'Close mini window' }).click()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha Mini')!.isVisible())).toBe(false)
    await page.keyboard.press('Control+Alt+M')
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha Mini')!.isVisible())).toBe(true)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha Mini')!.close())
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha Mini')!.isVisible())).toBe(false)
    await page.keyboard.press('Control+k')
    await page.locator('#palette-input').fill('Mini window')
    await page.locator('[data-command="view.mini"]').click()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha Mini')!.isVisible())).toBe(true)
  } finally { await closeApp(app) }
})

test('real terminal sessions show live plan items and progress while the host is minimized', async () => {
  const sandbox = createSandbox()
  const sessionId = 'mini-plan-session'
  const folder = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(folder, { recursive: true })
  const log = join(folder, `${sessionId}.jsonl`)
  const todo = (id: string, completed: number): string => JSON.stringify({ type: 'assistant', uuid: id,
    message: { content: [{ type: 'tool_use', id, name: 'TodoWrite', input: { todos: ['Read files', 'Run tests', 'Update docs'].map((content, n) => ({ content, status: n < completed ? 'completed' : n === completed ? 'in_progress' : 'pending' })) } }] } }) + '\n'
  writeFileSync(log, todo('p1', 1))
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const now = Date.now()
    writeFileSync(join(sandbox.sessionsDir, `${sessionId}.json`), JSON.stringify({ pid: process.pid, sessionId, cwd: sandbox.projectFolder, name: 'Billing refactor', nameSource: 'user', status: 'busy', startedAt: now + 1000, updatedAt: now + 1000 }))
    const mini = await openMini(app, page)
    await expect(mini.locator('.mini-card')).toContainText('Billing refactor')
    await expect(mini.locator('.mini-progress')).toContainText('1/3')
    await expect(mini.locator('.mini-card')).toHaveAttribute('data-state', 'working')
    await mini.locator('.mini-select').click()
    await expect(mini.locator('.mini-plan li')).toHaveCount(3)
    await expect(mini.locator('.mini-plan [data-status="in_progress"]')).toContainText('Run tests')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha')!.minimize())
    appendFileSync(log, todo('p2', 2))
    await expect(mini.locator('.mini-progress')).toContainText('2/3')
    await expect(mini.locator('.mini-plan [data-status="in_progress"]')).toContainText('Update docs')
    await mini.getByRole('button', { name: 'Back to all sessions' }).click()
    await expect(mini.locator('.mini-card')).toContainText('2/3')
  } finally { await closeApp(app) }
})

test('closing a detail session never transfers approval focus to another session', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const add = page.getByRole('button', { name: 'New Claude session in Smoke', exact: true })
    await add.click()
    await add.click()
    const panes = page.locator('.pane')
    const firstId = (await panes.first().getAttribute('data-pane-id'))!
    const ids = await panes.locator('.term-host.active').evaluateAll(els => els.map(el => el.getAttribute('data-term-id')!))
    const mini = await openMini(app, page)
    for (const id of ids) {
      await expect.poll(async () => (await bufferText(page, id)).replace(/\n/g, '').trimEnd()).toMatch(/[>$#%]$/)
      await feedTerminal(page, id, '● Bash(npm test)\r\nDo you want to proceed?\r\n1. Yes\r\n3. No\r\n')
    }
    await expect(mini.locator('.mini-card[data-state="needs"]')).toHaveCount(2)
    // This test is about focus, not motion: without the list/detail slide the slow CI runner cannot race it.
    await mini.emulateMedia({ reducedMotion: 'reduce' })
    const allow = mini.locator('.mini-detail').getByRole('button', { name: 'Allow', exact: true })
    await expect(async () => {
      if (!(await allow.isVisible())) await mini.locator(`.mini-card[data-pane-id="${firstId}"] .mini-select`).click({ timeout: 2000 })
      await expect(allow).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 20_000 })
    await allow.focus()
    await closePaneViaActions(panes.first())
    await expect(mini.locator('.mini-detail')).toHaveCount(0)
    await expect(mini.locator('.mini-card')).toHaveCount(1)
    expect(await mini.evaluate(() => !!document.activeElement?.closest('.mini-header'))).toBe(true)
  } finally { await closeApp(app) }
})

test('fold and sound persist across restart, detail and empty state work', async () => {
  const sandbox = createSandbox()
  let session = await launchApp(sandbox)
  try {
    const mini = await openMini(session.app, session.page)
    await expect(mini.getByText('No sessions open', { exact: true })).toBeVisible()
    await mini.getByRole('button', { name: 'New session', exact: true }).click()
    await expect(session.page.getByRole('dialog', { name: 'New session', exact: true })).toBeVisible()
    await session.page.keyboard.press('Escape')
    await session.page.getByRole('button', { name: /^New (Claude|Codex|Gemini) session in Smoke$/ }).click()
    await expect(mini.locator('.mini-card')).toHaveCount(1)
    await mini.locator('.mini-card .mini-select').click()
    await expect(mini.getByText('Terminal', { exact: true })).toBeVisible()
    await mini.getByRole('button', { name: 'Back to all sessions' }).click()
    await mini.getByRole('button', { name: 'Sound off' }).click()
    await expect.poll(() => readSettings(sandbox.userData).sessionInfo?.sound).toBe(true)
    await mini.getByRole('button', { name: 'Fold', exact: true }).click()
    await expect(mini.locator('.mini-folded')).toContainText('1 session')
    await expect.poll(() => readSettings(sandbox.userData).miniWindow?.folded).toBe(true)
  } finally { await closeApp(session.app) }
  session = await launchApp(sandbox)
  try {
    const mini = await openMini(session.app, session.page)
    await expect(mini.locator('.mini-folded')).toBeVisible()
    await mini.getByRole('button', { name: 'Unfold' }).click()
    await expect(mini.locator('.mini-card')).toHaveCount(1)
    expect(readSettings(sandbox.userData).sessionInfo?.sound).toBe(true)
  } finally { await closeApp(session.app) }
})

test('minimize preference opens Mini and restoring leaves it open, with live theme tokens and bounded scrolling', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('tab', { name: 'Notifications', exact: true }).click()
    await page.getByRole('switch', { name: 'Show the Mini window when Dawsha is minimized' }).click()
    await expect.poll(() => readSettings(sandbox.userData).miniWindow?.showOnMinimize).toBe(true)
    const opened = app.waitForEvent('window')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha')!.minimize())
    const mini = await opened
    await expect(mini.getByText('No sessions open', { exact: true })).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha')!.restore())
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha Mini')!.isVisible())).toBe(true)
    const hostPane = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pane').trim())
    await expect.poll(() => mini.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pane').trim())).toBe(hostPane)
    // Token propagation also covers the appearance worker's warm-tone surface overrides.
    await page.evaluate(() => document.documentElement.style.setProperty('--pane', 'rgb(32, 30, 28)'))
    await expect.poll(() => mini.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pane').trim())).toBe('rgb(32, 30, 28)')
    await mini.getByRole('button', { name: 'New session', exact: true }).click()
    await page.keyboard.press('Escape')
    const add = page.getByRole('button', { name: /^New (Claude|Codex|Gemini) session in Smoke$/ })
    for (let n = 0; n < 12; n += 1) await add.click()
    await expect(mini.locator('.mini-card')).toHaveCount(12)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha Mini')!.getBounds().height)).toBe(640)
    await expect.poll(() => mini.locator('.mini-content').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    expect(await mini.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await mini.getByRole('button', { name: 'Fold', exact: true }).click()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha Mini')!.getBounds().height)).toBe(58)
  } finally { await closeApp(app) }
})
