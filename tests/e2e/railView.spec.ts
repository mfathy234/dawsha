import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp } from './helpers'

const NEW_IN_SMOKE = /^New (Claude|Codex|Gemini) session in Smoke$/
const DESKTOP = { panes: 'quiet', frame: 'sidebar', tone: 'warm' }
const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

function seed(userData: string, patch: Record<string, unknown>): void {
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ ...readSettings(userData), ...patch }), 'utf8')
}

test('the collapsed rail folds empty projects behind the dots tile and keeps the sections in a Views menu', async () => {
  const sandbox = createSandbox()
  seed(sandbox.userData, { appearance: DESKTOP })
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).first().click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await page.locator('#sidebar-collapse').click()
    const rail = page.locator('.sidebar.rail')
    await expect(rail).toBeVisible()

    await expect(rail.locator('#files-button')).toBeHidden()
    await expect(rail.locator('#notifications-button')).toBeHidden()
    const smoke = rail.locator('.rail-tile', { has: page.locator('.rail-letters', { hasText: 'SM' }) })
    await expect(smoke).toHaveCount(1)
    await expect(smoke).not.toHaveClass(/rail-none/)
    await expect(smoke).toHaveCSS('width', '32px')
    await expect(smoke).toHaveCSS('height', '32px')
    await expect(rail.locator('.rail-tile')).toHaveCount(1)

    const more = rail.locator('#rail-more')
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await more.click()
    await expect(rail.locator('.rail-tile')).toHaveCount(2)
    await expect(rail.locator('.rail-tile.rail-none')).toHaveCount(1)
    await expect.poll(() => readSettings(sandbox.userData).railShowEmpty).toBe(true)
    await more.click()
    await expect(rail.locator('.rail-tile')).toHaveCount(1)

    const views = rail.locator('#rail-views')
    await views.click()
    const menu = page.getByRole('menu', { name: 'Views' })
    await expect(menu.getByRole('menuitem')).toHaveCount(6)
    for (const name of ['Sessions', 'Agents', 'Files', 'Work', 'Skills', 'Notifications']) await expect(menu.getByRole('menuitem', { name: new RegExp(`^${name}`) })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /^Work/ })).toContainText('Ctrl+Shift+W')
    await menu.getByRole('menuitem', { name: /^Files/ }).click()
    await expect(page.locator('.files-view')).toBeVisible()
    await expect(rail.locator('#rail-views')).toHaveAttribute('aria-label', 'Views, Files')

    await rail.locator('#rail-views').click()
    await page.getByRole('menuitem', { name: /^Notifications/ }).click()
    await expect(page.locator('.notifications-popover')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+Shift+W')
    await expect(page.locator('.work-view')).toBeVisible()
    await page.keyboard.press('Control+Shift+S')
    await expect(page.locator('.pane')).toHaveCount(1)
  } finally {
    await closeApp(app)
  }
})

test('tabs that do not fit collapse into a +N menu, and the open tab shows its header on one row', async () => {
  const sandbox = createSandbox()
  const names = ['Alpha One', 'Bravo Two', 'Charlie Three', 'Delta Four', 'Echo Five', 'Foxtrot Six', 'Golf Seven', 'Hotel Eight', 'Invoice export refactor with separate steps', 'Customer portal login flow and reset emails', 'Warehouse stock movements report finance', 'Payroll monthly close and tax declarations', 'Mobile app push notifications and deep links', 'Supplier onboarding wizard with document uploads']
  const projects = names.map((name, index) => {
    const folder = join(sandbox.root, `project-${index}`)
    mkdirSync(folder, { recursive: true })
    if (index === 0) execFileSync('git', ['init', '-q', '-b', 'feature-x'], { cwd: folder })
    return { id: `p${index}`, name, folder }
  })
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ version: 2, lastSeenVersion: APP_VERSION, tourSeen: true, projects, appearance: DESKTOP }), 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    for (const name of names) await page.getByRole('button', { name: new RegExp(`^New (Claude|Codex|Gemini) session in ${name}$`) }).click()
    await expect(page.locator('.pane')).toHaveCount(names.length)
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('.pane.maximized')).toHaveCount(1)

    const strip = page.locator('.pane-strip')
    const more = strip.locator('.strip-more')
    await expect(more).toBeVisible()
    await expect(more).toHaveText(/^\+\d+$/)
    const hidden = Number((await more.innerText()).slice(1))
    expect(hidden).toBeGreaterThan(0)
    await more.click()
    const menu = page.getByRole('menu', { name: 'More sessions' })
    await expect(menu.getByRole('menuitem')).toHaveCount(hidden)
    await menu.getByRole('menuitem').first().click()
    await expect(strip.locator('.strip-tab.selected')).toHaveCount(1)

    const header = page.locator('.pane.maximized .pane-header')
    const box = (await header.boundingBox())!
    expect(box.height).toBeLessThanOrEqual(48)
    await expect(page.locator('.pane.maximized .pane-foot .chip-branch')).toHaveCount(0)
    const title = page.locator('.pane.maximized .pane-title')
    expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 || getComputedStyle(el).textOverflow === 'ellipsis')).toBe(true)
  } finally {
    await closeApp(app)
  }
})
