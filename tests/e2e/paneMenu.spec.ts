import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const SCREENS = 'test-results/screens'

const openLog = (path: string): { kind?: string; folder?: string }[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : []

test('the pane menu shows icons and shortcuts, and opens the folder in VS Code or Visual Studio', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })

    const header = page.locator('.pane-header')
    for (const name of ['Session timeline', 'Replay session', 'Open in VS Code', 'Move pane', 'Previous pane', 'Next pane']) {
      await expect(header.getByRole('button', { name, exact: true })).toBeHidden()
    }
    await expect(header.getByRole('button', { name: 'Pane actions' })).toBeVisible()
    await expect(header.getByRole('button', { name: /^Dictate/ })).toBeVisible()
    await expect(header.getByRole('button', { name: 'Close pane' })).toBeVisible()
    await page.getByRole('button', { name: 'Pane actions' }).click()
    for (const name of ['Move pane…', 'Show session timeline', 'Replay session']) {
      await expect(page.getByRole('menuitem', { name })).toBeVisible()
    }
    await page.getByRole('menuitem', { name: 'Open in VS Code' }).click()
    await expect.poll(() => openLog(sandbox.openLog).map((entry) => entry.kind)).toEqual(['vscode'])
    expect(openLog(sandbox.openLog)[0].folder).toBe(sandbox.projectFolder)

    await page.getByRole('button', { name: 'Pane actions' }).click()
    const menu = page.getByRole('menu', { name: 'Pane actions' })
    await expect(menu.locator('.menu-item .menu-icon svg').first()).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /^Changes/ }).locator('.menu-kbd')).toHaveText('Ctrl+Shift+G')
    await expect(menu.getByRole('menuitem', { name: /^Copy last reply/ }).locator('.menu-kbd')).toHaveText('Ctrl+Alt+C')
    await expect(menu.getByRole('menuitem', { name: /^Find/ }).locator('.menu-kbd')).toHaveText('Ctrl+Shift+F')
    const studio = menu.getByRole('menuitem', { name: /^Open in Visual Studio/ })
    await expect(studio).toBeDisabled()
    await page.screenshot({ path: join(SCREENS, '62-pane-menu-icons.png') })
    await page.keyboard.press('Escape')

    writeFileSync(join(sandbox.projectFolder, 'AcmeWeb.sln'), '\n')
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await expect(studio).toBeEnabled()
    await expect(studio).toHaveAttribute('title', 'AcmeWeb.sln')
    await studio.click()
    await expect.poll(() => openLog(sandbox.openLog).map((entry) => entry.kind)).toEqual(['vscode', 'visualstudio'])
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
    const add = page.locator('.pane').getByRole('button', { name: /^New terminal in/ })

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

    await add.click()
    await expect(page.getByRole('menuitem', { name: 'Shell' })).toBeVisible()
    await add.click()
    await expect(page.getByRole('menu')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
