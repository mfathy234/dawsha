import { connect } from 'node:net'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, feedTerminal, launchApp, openSettings, QUIT_BUDGET_MS } from './helpers'

test('native import picker selects JSON, cancels quietly and imports through the preview', async () => {
  const sandbox = createSandbox()
  const file = join(sandbox.root, 'settings.json')
  writeFileSync(file, JSON.stringify({ app: 'dawsha', kind: 'settings-export', version: 1, data: { sessionsLayout: 'panel' } }))
  const { app, page } = await launchApp(sandbox, { DAWSHA_OPEN_PATH: '' })
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog
    })
    await openSettings(page, 'import')
    await page.locator('#import-settings').click()
    await expect(page.getByRole('dialog', { name: 'Import settings' })).toHaveCount(0)
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as { defaultPath: string; filters: unknown[] }
        if (!options.defaultPath || JSON.stringify(options.filters) !== JSON.stringify([{ name: 'JSON', extensions: ['json'] }])) throw new Error('Invalid picker options')
        return { canceled: false, filePaths: [path] }
      }) as typeof dialog.showOpenDialog
    }, file)
    await page.locator('#import-settings').click()
    const preview = page.getByRole('dialog', { name: 'Import settings' })
    await expect(preview).toBeVisible()
    expect(await preview.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight
    })).toBe(true)
    await preview.getByRole('button', { name: 'Import' }).click()
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))?.sessionsLayout).toBe('panel')
  } finally { await closeApp(app) }
})

test('linked skills appear once alongside ordinary skills', async () => {
  const sandbox = createSandbox()
  const root = join(sandbox.claudeHome, 'skills')
  const target = join(sandbox.root, 'synced-skill')
  mkdirSync(root, { recursive: true })
  mkdirSync(target)
  writeFileSync(join(target, 'SKILL.md'), '---\ndescription: A linked skill\n---\n# Review')
  symlinkSync(target, join(root, 'Review'), 'junction')
  symlinkSync(target, join(root, 'ReviewAgain'), 'junction')
  symlinkSync(root, join(root, 'Loop'), 'junction')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#skills-button').click()
    await expect(page.locator('.skill-row')).toHaveCount(1)
    await expect(page.locator('.skill-row')).toContainText('Linked')
    await expect(page.locator('.skill-row')).toContainText('A linked skill')
  } finally { await closeApp(app) }
})

test('new waiting sessions flash once with notifications off, and focus stops flashing', async () => {
  const sandbox = createSandbox()
  const settingsPath = join(sandbox.userData, 'settings.json')
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  writeFileSync(settingsPath, JSON.stringify({ ...settings, sessionInfo: { notifications: false, sound: false } }))
  const { app, page } = await launchApp(sandbox, {}, ['--new-session=smoke'])
  try {
    await expect(page.locator('.pane')).toHaveCount(1)
    await page.locator('#new-session').click()
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(2)
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      const state = globalThis as unknown as { platformFlashes: boolean[] }
      state.platformFlashes = []
      window.isFocused = () => false
      window.flashFrame = value => { state.platformFlashes.push(value) }
    })
    const id = await page.locator('.term-host').first().getAttribute('data-term-id')
    const prompt = '\r\n  npm test -- invoices\r\nDo you want to run this command?\r\n ❯ 1. Yes\r\n   2. No, and tell Claude what to do differently\r\n'
    await expect(async () => {
      await feedTerminal(page, id!, prompt)
      expect(await app.evaluate(() => (globalThis as unknown as { platformFlashes: boolean[] }).platformFlashes.filter(Boolean).length)).toBe(1)
    }).toPass({ timeout: 15000 })
    await feedTerminal(page, id!, prompt)
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { platformFlashes: boolean[] }).platformFlashes.filter(Boolean).length)).toBe(1)
    await page.locator('.pane').first().locator('.pane-title').click()
    await page.evaluate(() => {
      document.hasFocus = () => true
      window.dispatchEvent(new Event('focus'))
    })
    await expect(page.locator('.pane').first()).toHaveAttribute('data-attention', 'none')
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].isFocused = () => true
      BrowserWindow.getAllWindows()[0].emit('focus')
    })
    expect(await app.evaluate(() => (globalThis as unknown as { platformFlashes: boolean[] }).platformFlashes.at(-1))).toBe(false)
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].isFocused = () => false })
    await page.evaluate(() => {
      document.hasFocus = () => false
      window.dispatchEvent(new Event('blur'))
    })
    await expect(page.locator('.pane').first()).toHaveAttribute('data-attention', 'needs')
    expect(await app.evaluate(() => (globalThis as unknown as { platformFlashes: boolean[] }).platformFlashes.filter(Boolean).length)).toBe(1)
    expect(readFileSync(settingsPath, 'utf8')).toContain('"smoke"')
  } finally { await closeApp(app) }
})

test('desktop actions work at launch and through second-instance', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, {}, ['--new-session'])
  try {
    await expect(page.locator('.quickpick')).toBeVisible()
    await page.keyboard.press('Escape')
    await app.evaluate(({ app }, cwd) => { app.emit('second-instance', {}, ['Dawsha.exe', '--new-session=smoke'], cwd) }, sandbox.projectFolder)
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))?.recentProjectIds?.[0]).toBe('smoke')
    await app.evaluate(({ app }, cwd) => { app.emit('second-instance', {}, ['Dawsha.exe', '--new-session'], cwd) }, sandbox.projectFolder)
    await expect(page.locator('.quickpick')).toBeVisible()
  } finally { await closeApp(app) }
})

test('Windows jump list follows project changes', async () => {
  test.skip(process.platform !== 'win32', 'Windows taskbar integration')
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await app.evaluate(({ app }) => {
      app.getJumpListSettings = () => ({ minItems: 10, removedItems: [] })
      app.setJumpList = categories => {
        (globalThis as unknown as { platformJumpList: unknown }).platformJumpList = categories
        return 'ok'
      }
    })
    await page.evaluate(async () => {
      const { settings } = await window.gridApi.getSettings()
      await window.gridApi.updateSettings({ projects: settings.projects.map(project => ({ ...project, name: `Renamed ${project.name}` })) })
    })
    const categories = await app.evaluate(() => (globalThis as unknown as { platformJumpList: Array<{ name?: string; items: Array<{ title: string }> }> }).platformJumpList)
    expect(categories[0].name).toBe('Projects')
    expect(categories[0].items[0].title).toBe('New Claude session in Renamed Smoke')
    expect(categories[1].items.map(item => item.title)).toEqual(['New session', 'Mini window'])
  } finally { await closeApp(app) }
})

test('quit closes a half-written CLI connection and Chromium utility children', async () => {
  const sandbox = createSandbox()
  const { app } = await launchApp(sandbox)
  const pids = await app.evaluate(({ app }) => app.getAppMetrics().map(metric => metric.pid))
  const socket = connect(sandbox.pipe)
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
  socket.write('{')
  const closed = new Promise<void>(resolve => socket.once('close', () => resolve()))
  try {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
    await closed
    await expect.poll(() => pids.filter(pid => { try { process.kill(pid, 0); return true } catch { return false } })).toEqual([])
    expect(readFileSync(sandbox.quitLog, 'utf8')).toContain('stop services done')
  } finally { socket.destroy(); await closeApp(app) }
})

test('updater restart uses the same service cleanup with an open CLI client', async () => {
  const sandbox = createSandbox()
  const updaterLog = join(sandbox.root, 'updater.log')
  const { app, page } = await launchApp(sandbox, {
    DAWSHA_TEST_UPDATER: 'fake',
    DAWSHA_TEST_UPDATER_SCRIPT: JSON.stringify({ check: 'available', info: { version: '9.9.0' }, hold: false }),
    DAWSHA_TEST_UPDATER_LOG: updaterLog,
    DAWSHA_UPDATE_START_DELAY_MS: '200'
  })
  const socket = connect(sandbox.pipe)
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
  socket.write('{')
  const closed = new Promise<void>(resolve => socket.once('close', () => resolve()))
  try {
    await page.locator('#update-pill').click()
    await page.locator('#update-now').click()
    await expect(page.locator('#update-pill')).toHaveText('Restart to update')
    if (await page.locator('.update-popover').count() === 0) await page.locator('#update-pill').click()
    await page.locator('#update-restart').click()
    await closed
    await expect.poll(() => readFileSync(updaterLog, 'utf8')).toContain('quitAndInstall true true')
    expect(readFileSync(sandbox.quitLog, 'utf8')).toContain('stop services done')
  } finally { socket.destroy(); await closeApp(app) }
})
