import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { bufferText, closeApp, createSandbox, launchApp, openSettings, type Sandbox } from './helpers'

function seed(sandbox: Sandbox, desktop: { closeBehavior: 'quit' | 'tray'; startHidden: boolean }): void {
  const path = join(sandbox.userData, 'settings.json')
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), desktop }))
}

const notices = (file: string): string[] => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : []

test('close keeps agents and Mini alive, tray Show restores Dawsha, and Quit stops services', async () => {
  const sandbox = createSandbox()
  seed(sandbox, { closeBehavior: 'tray', startHidden: false })
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    const termId = (await page.locator('.term-host.active').first().getAttribute('data-term-id'))!
    await expect.poll(() => bufferText(page, termId)).toMatch(/[>$#%]/)
    // Capture the real tray menu when Mini visibility rebuilds it, without a production test hook.
    await app.evaluate(({ Menu }) => {
      const build = Menu.buildFromTemplate.bind(Menu)
      Menu.buildFromTemplate = template => {
        const menu = build(template)
        if (menu.items.some(item => item.label === 'Show Dawsha')) (globalThis as any).__trayMenu = menu
        return menu
      }
    })
    const opened = app.waitForEvent('window')
    await page.evaluate(() => window.gridApi.miniWindow.toggle())
    const mini = await opened
    await expect(mini.locator('#mini')).toBeVisible()
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).__trayMenu)).toBe(true)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== 'Dawsha Mini')!.close())
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== 'Dawsha Mini')!.isVisible())).toBe(false)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Dawsha Mini')!.isVisible())).toBe(true)
    await page.evaluate(id => window.gridApi.write(id, 'echo tray_agent_still_running\r'), termId)
    await expect.poll(() => bufferText(page, termId)).toContain('tray_agent_still_running')
    await expect.poll(() => notices(sandbox.notifyLog).filter(line => line.includes('Dawsha is still running in the tray')).length).toBe(1)
    await app.evaluate(() => {
      const item = (globalThis as any).__trayMenu.items.find((item: any) => item.label === 'Show Dawsha')
      item.click()
    })
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== 'Dawsha Mini')!.isVisible())).toBe(true)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== 'Dawsha Mini')!.close())
    await app.evaluate(() => (globalThis as any).__trayMenu.items.find((item: any) => item.label === 'Show Dawsha').click())
    expect(notices(sandbox.notifyLog).filter(line => line.includes('Dawsha is still running in the tray'))).toHaveLength(1)
    const closed = page.waitForEvent('close')
    await app.evaluate(() => (globalThis as any).__trayMenu.items.find((item: any) => item.label === 'Quit').click())
    await closed
    expect(readFileSync(sandbox.quitLog, 'utf8')).toContain('stop services done')
    expect(readFileSync(sandbox.quitLog, 'utf8')).toContain('terminateAll done')
  } finally { await closeApp(app) }
})

test('General persists close behavior and shows sign-in disabled in development', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'general')
    await expect(page.locator('#desktop-close-behavior')).toHaveValue('quit')
    await expect(page.locator('#desktop-login-toggle')).toBeDisabled()
    await expect(page.getByText('Available in the installed app.', { exact: true })).toBeVisible()
    await page.locator('#settings-search').fill('start Dawsha')
    await expect(page.locator('#desktop-login-toggle')).toBeVisible()
    await page.locator('#settings-search').fill('')
    await page.locator('#desktop-close-behavior').focus()
    await page.locator('#desktop-close-behavior').selectOption('tray')
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).desktop?.closeBehavior).toBe('tray')
    await expect(page.locator('#desktop-hidden-toggle')).toBeDisabled()
    await expect(page.locator('#desktop-close-behavior')).toBeFocused()
    await page.locator('#settings-back').click()
    await page.locator('#more-button').click()
    const closed = page.waitForEvent('close')
    await page.getByRole('menuitem', { name: 'Quit Dawsha', exact: true }).click()
    await closed
    expect(readFileSync(sandbox.quitLog, 'utf8')).toContain('stop services done')
  } finally { await closeApp(app) }
})

test('hidden startup stays hidden and a second launch restores it', async () => {
  const sandbox = createSandbox()
  seed(sandbox, { closeBehavior: 'tray', startHidden: true })
  const { app } = await launchApp(sandbox, {}, ['--hidden'])
  try {
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
    await app.evaluate(({ app }) => app.emit('second-instance', {}, [process.execPath], process.cwd(), {}))
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
    expect(notices(sandbox.notifyLog)).toEqual([])
  } finally { await closeApp(app) }
})

test('Quit from a hidden window reveals unsaved-file confirmation and Cancel keeps the edit', async () => {
  const sandbox = createSandbox()
  seed(sandbox, { closeBehavior: 'tray', startHidden: false })
  writeFileSync(join(sandbox.projectFolder, 'tray-note.txt'), 'Keep this note\n')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#files-button').click()
    await page.locator('.files-row[data-path="tray-note.txt"]').click()
    const editor = page.locator('.files-editor:not([hidden]) .cm-content')
    await editor.click()
    await page.keyboard.press('e')
    await page.keyboard.type('unsaved tray edit')
    await expect(page.locator('.files-tab.active')).toHaveClass(/dirty/)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
    await app.evaluate(({ app }) => app.quit())
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('tray-note.txt')
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(editor).toContainText('unsaved tray edit')
    expect(readFileSync(join(sandbox.projectFolder, 'tray-note.txt'), 'utf8')).toBe('Keep this note\n')
    await page.locator('.files-tab-close').click()
    await page.getByRole('button', { name: /^Discard changes to/ }).click()
  } finally { await closeApp(app) }
})
