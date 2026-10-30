import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openTerminalPicker } from './helpers'

const SCREENS = 'test-results/screens'

const openLog = (path: string): { kind?: string; folder?: string }[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : []

test('the pane menu is short and grouped, and the rest of the actions are in the command palette', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })

    const header = page.locator('.pane-header')
    await expect(header.getByRole('button', { name: 'Close pane' })).toBeVisible()
    await expect(header.getByRole('button', { name: 'Pane actions' })).toBeVisible()
    await page.getByRole('button', { name: 'Pane actions' }).click()
    const menu = page.getByRole('menu', { name: 'Pane actions' })
    for (const name of ['Move pane…', 'Show session timeline', 'Replay session', 'Close pane']) {
      await expect(menu.getByRole('menuitem', { name })).toBeVisible()
    }
    expect(await menu.getByRole('menuitem').count()).toBeLessThanOrEqual(13)
    await expect(menu.getByRole('menuitem', { name: /^Changes/ }).locator('.menu-kbd')).toHaveText('Ctrl+Shift+G')
    await expect(menu.getByRole('menuitem', { name: /^Find/ }).locator('.menu-kbd')).toHaveText('Ctrl+Shift+F')
    await expect(menu.locator('.menu-item .menu-icon svg').first()).toBeVisible()
    await page.screenshot({ path: join(SCREENS, '62-pane-menu-icons.png') })
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+k')
    await expect(page.locator('#palette-input')).toBeFocused()
    await page.locator('#palette-input').fill('Open in VS Code')
    await page.keyboard.press('Enter')
    await expect.poll(() => openLog(sandbox.openLog).map((entry) => entry.kind)).toEqual(['vscode'])
    expect(openLog(sandbox.openLog)[0].folder).toBe(sandbox.projectFolder)
  } finally {
    await closeApp(app)
  }
})

test('pane header menus close on a second click of their button, including Move pane', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    const actions = page.locator('.pane').getByRole('button', { name: 'Pane actions' })

    await actions.click()
    await expect(page.getByRole('menu', { name: 'Pane actions' })).toBeVisible()
    await actions.click()
    await expect(page.getByRole('menu')).toHaveCount(0)

    // Move pane… replaces the actions menu; the Pane actions button then closes it.
    await actions.click()
    await page.getByRole('menuitem', { name: 'Move pane…' }).click()
    await expect(page.getByRole('menu', { name: 'Move pane to position' })).toBeVisible()
    await expect(page.getByRole('menu', { name: 'Pane actions' })).toHaveCount(0)
    await actions.click()
    await expect(page.getByRole('menu')).toHaveCount(0)

    await openTerminalPicker(page.locator('.pane').first())
    await expect(page.getByRole('menuitem', { name: 'Shell' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
