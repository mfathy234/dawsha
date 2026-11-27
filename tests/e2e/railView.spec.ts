import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { colorOfProject } from '../../src/shared/projectColor'
import { APP_VERSION, closeApp, createSandbox, launchApp } from './helpers'

const NEW_IN_SMOKE = /^New (Claude|Codex|Gemini) session in Smoke$/
const DESKTOP = { panes: 'quiet', frame: 'sidebar', tone: 'warm' }
const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

function seed(userData: string, patch: Record<string, unknown>): void {
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ ...readSettings(userData), ...patch }), 'utf8')
}

test('the collapsed rail lists projects without sessions last, with no dots tile, and keeps the sections in a Views menu', async () => {
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
    await expect(smoke).toHaveCSS('width', '40px')
    await expect(smoke).toHaveCSS('height', '40px')
    await expect(smoke).toHaveCSS('border-radius', '12px')
    await expect(smoke.locator('.rail-pill')).toHaveCSS('height', '32px')
    await expect(rail.locator('#rail-more')).toHaveCount(0)
    await expect(rail.locator('.rail-tile')).toHaveCount(2)
    await expect(rail.locator('.rail-tile.rail-none')).toHaveCount(1)
    await expect(rail.locator('.rail-tile').last()).toHaveClass(/rail-none/)

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

test('the rail is one 40px column on a 64px centre line, in order, and still fits a 1024x728 window', async () => {
  const sandbox = createSandbox()
  seed(sandbox.userData, { appearance: DESKTOP })
  const { app, page } = await launchApp(sandbox)
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 728))
    await page.getByRole('button', { name: NEW_IN_SMOKE }).first().click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await page.locator('#sidebar-collapse').click()
    const rail = page.locator('.sidebar.rail')
    await expect(rail).toBeVisible()
    const railBox = (await rail.boundingBox())!
    expect(Math.round(railBox.width)).toBe(64)
    const controls = ['.app-logo-menu', '#new-session', '#search-button', '.rail-tile[data-drop-project="smoke"]', '#rail-views', '[aria-label="Add project"]', '#settings-button', '#sidebar-expand']
    const boxes = []
    for (const selector of controls) {
      const box = (await rail.locator(selector).first().boundingBox())!
      expect(box, selector).not.toBeNull()
      expect(Math.round(box.width), `${selector} width`).toBe(40)
      expect(Math.round(box.height), `${selector} height`).toBe(40)
      expect(Math.abs(box.x + box.width / 2 - (railBox.x + 32)), `${selector} centre`).toBeLessThanOrEqual(1)
      boxes.push(box)
    }
    for (let index = 1; index < boxes.length; index += 1) expect(boxes[index].y, controls[index]).toBeGreaterThanOrEqual(boxes[index - 1].y + 40)
    expect(boxes[boxes.length - 1].y + 40).toBeLessThanOrEqual(railBox.y + railBox.height)
    await expect(rail.locator('#new-session')).toHaveCSS('border-radius', '50%')
    await expect(rail.locator('#search-button')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(rail.locator('#sidebar-expand')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(rail.locator('.rail-divider')).toHaveCount(2)
    await expect(rail.locator('.rail-divider').first()).toHaveCSS('width', '32px')
    await expect(rail.locator('.rail-divider').first()).toHaveCSS('height', '2px')
    const ring = await rail.locator('.rail-tile[data-drop-project="smoke"] .rail-face').evaluate((face) => getComputedStyle(face, '::after').boxShadow)
    const [red, green, blue] = [1, 3, 5].map((start) => parseInt(colorOfProject({ name: 'Smoke' }).color.slice(start, start + 2), 16))
    expect(ring).toContain(`rgb(${red}, ${green}, ${blue})`)
    expect(ring).toContain('2px')
    const noSessions = await rail.locator('.rail-tile.rail-none .rail-face').first().evaluate((face) => getComputedStyle(face, '::after').boxShadow)
    expect(noSessions).toContain('1px')
    const list = (await rail.locator('.rail-projects').boundingBox())!
    expect(list.y).toBeGreaterThanOrEqual(boxes[2].y + 40)
    expect(list.y + list.height).toBeLessThanOrEqual(boxes[4].y)
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

const SVG = (fill: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/></svg>`

test('rail tiles are neutral circles with a left pill, and a project icon can be changed or swapped for initials', async () => {
  const sandbox = createSandbox()
  seed(sandbox.userData, { appearance: DESKTOP })
  writeFileSync(join(sandbox.projectFolder, 'favicon.svg'), SVG('#2255aa'), 'utf8')
  const idleFolder = join(sandbox.root, 'Idle')
  mkdirSync(idleFolder, { recursive: true })
  writeFileSync(join(idleFolder, 'favicon.svg'), SVG('#118855'), 'utf8')
  seed(sandbox.userData, { projects: [...readSettings(sandbox.userData).projects, { id: 'idle', name: 'Idle', folder: idleFolder }] })
  const picked = join(sandbox.root, 'picked.svg')
  writeFileSync(picked, SVG('#aa5522'), 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as unknown as typeof dialog.showOpenDialog
    }, picked)
    await page.getByRole('button', { name: NEW_IN_SMOKE }).first().click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await page.locator('#sidebar-collapse').click()
    const rail = page.locator('.sidebar.rail')
    expect(await rail.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(64)
    const smoke = rail.locator('.rail-tile[data-drop-project="smoke"]')
    const missing = rail.locator('.rail-tile[data-drop-project="gone"]')

    await expect(smoke).toHaveClass(/has-image/)
    await expect(smoke.locator('.rail-icon')).toBeVisible()
    await expect(smoke.locator('.rail-face')).toHaveCSS('padding', '8px')
    await expect(smoke).toHaveCSS('border-radius', '12px')
    const idle = rail.locator('.rail-tile[data-drop-project="idle"]')
    await expect(idle).toHaveClass(/has-image/)
    await expect(idle).toHaveClass(/rail-none/)
    await expect(idle).toHaveCSS('border-radius', '50%')
    await expect(idle.locator('.rail-face')).toHaveCSS('opacity', '0.55')
    await expect(smoke.locator('.rail-icon')).toHaveCSS('object-fit', 'contain')
    await expect(smoke.locator('.rail-pill')).toHaveCSS('height', '32px')
    await expect(smoke.locator('.rail-pill')).toHaveCSS('width', '4px')
    await expect(missing).toHaveCSS('border-radius', '50%')
    await expect(missing.locator('.rail-pill')).toHaveCSS('height', '0px')
    await expect(missing.locator('.rail-face')).toHaveCSS('opacity', '0.55')
    await expect(missing.locator('.rail-letters')).toHaveText('MI')
    await expect(rail.locator('.rail-sep')).toHaveCount(1)

    await missing.hover()
    await expect(page.locator('.rail-tip.shown')).toHaveText('Missing')
    await expect(missing.locator('.rail-pill')).toHaveCSS('height', '20px')
    await expect(missing).toHaveCSS('border-radius', '12px')

    await smoke.click()
    await page.getByRole('menuitem', { name: 'Use initials' }).click()
    await expect(smoke).not.toHaveClass(/has-image/)
    await expect(smoke.locator('.rail-letters')).toBeVisible()
    await expect.poll(() => readSettings(sandbox.userData).projects?.find((p: any) => p.id === 'smoke')?.noIcon).toBe(true)

    await smoke.click()
    await expect(page.getByRole('menuitem', { name: 'Use initials' })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Change icon…' }).click()
    await expect(smoke).toHaveClass(/has-image/)
    await expect.poll(() => readSettings(sandbox.userData).projects?.find((p: any) => p.id === 'smoke')?.iconPath).toBe(picked)
  } finally {
    await closeApp(app)
  }
})
