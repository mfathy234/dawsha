import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, closePaneViaActions, createSandbox, feedTerminal, launchApp, type Sandbox, openQuietProject } from './helpers'

const SCREENS = 'test-results/screens'
const NEW_IN_SMOKE = /^New (Claude|Codex|Gemini) session in Smoke$/
const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
const writeSettings = (sandbox: Sandbox, patch: Record<string, unknown>): void =>
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ ...readSettings(sandbox.userData), ...patch }), 'utf8')
const focusedNav = (page: Page): Promise<string | undefined> => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.nav)
const projectNames = (page: Page) => page.locator('.proj-list .proj-name')

function seedThreeProjects(sandbox: Sandbox): void {
  const other = join(sandbox.root, 'Other Project')
  mkdirSync(other, { recursive: true })
  const { projects } = readSettings(sandbox.userData)
  writeSettings(sandbox, { sidebarSort: 'manual', projects: [...projects, { id: 'other', name: 'Other', folder: other }] })
}

async function openMenu(page: Page, name: string) {
  await page.getByRole('button', { name: `Project actions for ${name}` }).click()
  return page.getByRole('menu')
}

test('pinned projects lead the sidebar, move within their group and persist after a restart', async () => {
  const sandbox = createSandbox()
  seedThreeProjects(sandbox)
  let session = await launchApp(sandbox)
  try {
    const { page } = session
    await expect(projectNames(page)).toHaveText(['Smoke', 'Missing', 'Other'])

    let menu = await openMenu(page, 'Other')
    await expect(menu.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Pin to top' }).click()
    await expect(projectNames(page)).toHaveText(['Other', 'Smoke', 'Missing'])
    await expect(page.locator('.proj-row', { hasText: 'Other' }).getByRole('img', { name: 'Pinned' })).toBeVisible()
    await page.locator('.sidebar').screenshot({ path: join(SCREENS, 'sidebar-pinned.png') })

    const pinnedRow = page.locator('.proj-row').first()
    await pinnedRow.hover()
    await expect(pinnedRow.locator('.proj-acts')).toHaveCSS('opacity', '1')
    await pinnedRow.locator('.proj-name').evaluate((node) => { node.textContent = 'A very long project name that cannot possibly fit in the sidebar row' })
    const pin = await pinnedRow.locator('.proj-pin').boundingBox()
    const acts = await pinnedRow.locator('.proj-acts').boundingBox()
    const name = await pinnedRow.locator('.proj-name').boundingBox()
    expect(pin && acts && name).toBeTruthy()
    expect(pin!.x + pin!.width, 'the pin and the hover actions do not intersect').toBeLessThanOrEqual(acts!.x + 0.5)
    expect(name!.x + name!.width, 'the name ends before the pin').toBeLessThanOrEqual(pin!.x + 0.5)
    expect(await pinnedRow.locator('.proj-name').evaluate((node) => node.scrollWidth > node.clientWidth), 'a long name ellipsizes').toBe(true)
    await page.locator('.sidebar').screenshot({ path: join(SCREENS, 'sidebar-pinned-hover.png') })

    menu = await openMenu(page, 'Other')
    await expect(menu.getByRole('menuitem', { name: 'Unpin' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    menu = await openMenu(page, 'Smoke')
    await expect(menu.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Move down' }).click()
    await expect(projectNames(page)).toHaveText(['Other', 'Missing', 'Smoke'])
    await expect.poll(() => readSettings(sandbox.userData).projects.map((p: any) => p.id)).toEqual(['gone', 'smoke', 'other'])
    expect(readSettings(sandbox.userData).projects[2].pinned).toBe(true)
  } finally {
    await closeApp(session.app)
  }
  session = await launchApp(sandbox)
  try {
    const { page } = session
    await expect(projectNames(page)).toHaveText(['Other', 'Missing', 'Smoke'])
    const menu = await openMenu(page, 'Other')
    await menu.getByRole('menuitem', { name: 'Unpin' }).click()
    await expect(projectNames(page)).toHaveText(['Missing', 'Smoke', 'Other'])
    await expect.poll(() => readSettings(sandbox.userData).projects.some((p: any) => p.pinned)).toBe(false)
  } finally {
    await closeApp(session.app)
  }
})

test('the collapsed rail marks projects whose sessions need you', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const add = page.getByRole('button', { name: NEW_IN_SMOKE })
    await add.click()
    await add.click()
    await expect(page.locator('.pane')).toHaveCount(2)
    const first = page.locator('.pane').nth(0)
    const second = page.locator('.pane').nth(1)
    const firstId = await first.locator('.term-host.active').getAttribute('data-term-id')
    await second.locator('.pane-title').click()
    await expect(second).toHaveClass(/focused/)
    // ConPTY may redraw after the new panes resize. Feed the simulated prompt until it survives that redraw.
    await expect(async () => {
      await feedTerminal(page, firstId!, ['Do you want to proceed?', '1. Yes', '3. No, and tell Claude what to do differently', ''].join('\r\n'))
      await expect.poll(() => bufferText(page, firstId!), { timeout: 1500 }).toContain('1. Yes')
      await expect(first).toHaveAttribute('data-attention', 'needs', { timeout: 1500 })
    }).toPass({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    const rail = page.locator('.sidebar.rail')
    const smoke = rail.getByRole('button', { name: 'Smoke, 1 needs you' })
    await expect(smoke).toBeVisible()
    await expect(smoke.locator('.rail-badge')).toHaveText('!')
    await expect(rail.getByRole('button', { name: 'Missing', exact: true })).toBeVisible()
    await expect(rail.locator('.rail-badge')).toHaveCount(1)
    await rail.screenshot({ path: join(SCREENS, 'sidebar-rail-badge.png') })

    await first.locator('.pane-title').click()
    await expect(first).toHaveAttribute('data-attention', 'none')
    await expect(rail.locator('.rail-badge')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('the project menu works from the keyboard and focus returns to the project after a move', async () => {
  const sandbox = createSandbox()
  writeSettings(sandbox, { sidebarSort: 'manual' })
  const { app, page } = await launchApp(sandbox)
  try {
    const button = page.getByRole('button', { name: 'Project actions for Smoke' })
    await button.focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const focusedItem = (): Promise<string | null> => page.evaluate(() => document.activeElement?.textContent ?? null)
    expect(await focusedItem()).toContain('Claude session')
    await page.keyboard.press('ArrowDown')
    expect(await focusedItem()).toContain('Codex session')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    expect(await focusedItem()).toBe('Remove Smoke from Dawsha…')
    await page.keyboard.press('Home')
    expect(await focusedItem()).toContain('Claude session')
    await page.keyboard.press('End')
    expect(await focusedItem()).toBe('Remove Smoke from Dawsha…')

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(button).toBeFocused()

    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(menu).toHaveCount(0)
    await expect(button).toBeFocused()

    await page.keyboard.press('Enter')
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Space')
    await expect(projectNames(page)).toHaveText(['Missing', 'Smoke'])
    expect(await focusedNav(page)).toBe('p:smoke')

    await page.getByRole('button', { name: 'Project actions for Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Pin to top' }).press('Enter')
    await expect(projectNames(page)).toHaveText(['Smoke', 'Missing'])
    expect(await focusedNav(page)).toBe('p:smoke')
  } finally {
    await closeApp(app)
  }
})

// A Gemini pane counts as working while it prints, so closing it may ask first.
async function closeFirstPane(page: Page): Promise<void> {
  await closePaneViaActions(page.locator('.pane').first())
  const confirm = page.getByRole('alertdialog').locator('[data-confirm]')
  if (await confirm.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false)) await confirm.click()
}

async function dragProject(page: Page, from: string, to: string, release: 'drop' | 'escape' | 'hold'): Promise<void> {
  const source = (await page.locator('.proj-name', { hasText: from }).boundingBox())!
  const target = (await page.locator('.proj-name', { hasText: to }).boundingBox())!
  await page.mouse.move(source.x + 10, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + 14, source.y + source.height / 2 + 12, { steps: 3 })
  await page.mouse.move(target.x + 10, target.y + target.height / 2, { steps: 8 })
  if (release === 'hold') return
  if (release === 'escape') await page.keyboard.press('Escape')
  await page.mouse.up()
}

test('dragging a project onto another moves it within its group, shows a drop line and Esc cancels', async () => {
  const sandbox = createSandbox()
  seedThreeProjects(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(projectNames(page)).toHaveText(['Smoke', 'Missing', 'Other'])
    await dragProject(page, 'Smoke', 'Other', 'hold')
    await expect(page.locator('.proj-row.drop-after')).toHaveCount(1)
    await expect(page.locator('.proj-row.drop-after .proj-name')).toHaveText('Other')
    mkdirSync(SCREENS, { recursive: true })
    await page.locator('.sidebar').screenshot({ path: join(SCREENS, '162-sidebar-drag.png') })
    await page.mouse.up()
    await expect(projectNames(page)).toHaveText(['Missing', 'Other', 'Smoke'])
    await expect.poll(() => readSettings(sandbox.userData).projects.map((p: any) => p.id)).toEqual(['gone', 'other', 'smoke'])
    await expect(page.locator('.pane')).toHaveCount(0)
    await expect(page.locator('.proj-row.drop-after, .proj-row.drop-before')).toHaveCount(0)

    await dragProject(page, 'Other', 'Missing', 'hold')
    await expect(page.locator('.proj-row.drop-before .proj-name')).toHaveText('Missing')
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(projectNames(page)).toHaveText(['Missing', 'Other', 'Smoke'])
    await expect(page.locator('.proj-row.drop-before')).toHaveCount(0)
    expect(readSettings(sandbox.userData).projects.map((p: any) => p.id)).toEqual(['gone', 'other', 'smoke'])

    const menu = await openMenu(page, 'Smoke')
    await menu.getByRole('menuitem', { name: 'Pin to top' }).click()
    await expect(projectNames(page)).toHaveText(['Smoke', 'Missing', 'Other'])
    await dragProject(page, 'Other', 'Smoke', 'drop')
    await expect(projectNames(page)).toHaveText(['Smoke', 'Missing', 'Other'])
  } finally {
    await closeApp(app)
  }
})

const KEPT_ID = (i: number): string => `00000000-0000-4000-8000-00000000050${i}`

test('F2 and double click rename open sessions; Enter and blur save, Esc and empty cancel', async () => {
  const sandbox = createSandbox()
  let session = await launchApp(sandbox)
  try {
    const { page } = session
    await page.getByRole('button', { name: 'Project actions for Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Gemini session' }).click()
    const open = page.locator('.kept-session-row:not(.closed) .sess-row')
    const name = open.locator('.sess-name')
    await expect(name).toHaveText('Gemini session 1')

    await open.dblclick()
    const field = page.getByRole('textbox', { name: /^Rename/ })
    await expect(field).toBeFocused()
    await expect(field).toHaveAttribute('dir', 'auto')
    mkdirSync(SCREENS, { recursive: true })
    await field.fill('Never saved')
    await page.keyboard.press('Escape')
    await expect(name).toHaveText('Gemini session 1')
    expect(await focusedNav(page)).toMatch(/^s:/)

    await page.keyboard.press('F2')
    await page.getByRole('textbox', { name: /^Rename/ }).fill('   ')
    await page.keyboard.press('Enter')
    await expect(name).toHaveText('Gemini session 1')

    await page.keyboard.press('F2')
    await page.getByRole('textbox', { name: /^Rename/ }).fill('عنوان الجلسة')
    await page.locator('.sidebar-head').click()
    await expect(name).toHaveText('عنوان الجلسة')

    await open.focus()
    await page.keyboard.press('F2')
    const openField = page.getByRole('textbox', { name: /^Rename/ })
    await openField.fill('x'.repeat(200))
    await expect(openField).toHaveValue('x'.repeat(160))
    await openField.fill('Release notes')
    await page.keyboard.press('Enter')
    await expect(name).toHaveText('Release notes')
    await expect(page.locator('.pane-title')).toContainText('Release notes')
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.[0]?.tabs?.[0]?.name, { timeout: 15_000 }).toBe('Release notes')

    await closeFirstPane(page)
    await expect(page.locator('.pane')).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox.userData).keptSessions.some((s: any) => s.title === 'Release notes' && s.renamed === true)).toBe(true)
  } finally {
    await closeApp(session.app)
  }
})

test('a session row wraps its title, keeps the time on the right and shows its actions only on hover', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    const row = page.locator('.kept-session-row:not(.closed)').first()
    const longName = 'Reworking the projects sidebar so every long session name stays readable on two lines'
    await row.locator('.sess-row').dblclick()
    await page.getByRole('textbox', { name: /^Rename/ }).fill(longName)
    await page.keyboard.press('Enter')
    const name = row.locator('.sess-name')
    await expect(name).toHaveText(longName)
    const lineHeight = parseFloat(await name.evaluate((node) => getComputedStyle(node).lineHeight))
    const nameBox = (await name.boundingBox())!
    expect(nameBox.height, 'the title wraps instead of being cut').toBeGreaterThan(lineHeight * 1.5)
    expect(await name.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true)

    const more = row.locator('.sess-more')
    const close = row.locator('.sess-close')
    await page.locator('.pane .pane-title').first().click()
    await page.mouse.move(700, 500)
    await expect(close).toHaveCSS('opacity', '0')
    await expect(more).toHaveCSS('opacity', '0')
    await row.hover()
    await expect(close).toHaveCSS('opacity', '1')
    await expect(more).toHaveCSS('opacity', '1')
    mkdirSync(SCREENS, { recursive: true })
    await page.locator('.sidebar').screenshot({ path: join(SCREENS, '186-sidebar-rows.png') })
  } finally {
    await closeApp(app)
  }
})

test('closed sessions fold into one line per project that opens Resume for that project', async () => {
  const sandbox = createSandbox()
  const now = Date.now()
  writeSettings(sandbox, {
    keptSessions: ['Alpha', 'Beta'].map((title, i) => ({ projectId: 'smoke', agent: 'claude', sessionId: KEPT_ID(i), title, closedAt: now - (2 - i) * 1_000 }))
  })
  const { app, page } = await launchApp(sandbox)
  try {
    await openQuietProject(page)
    await expect(page.locator('.kept-session-row.closed')).toHaveCount(0)
    const line = page.locator('.closed-line')
    await expect(line).toHaveText('2 closed today')
    await line.click()
    await expect(page.getByRole('dialog', { name: 'Start or resume a session' })).toBeVisible()
    await expect(page.locator('#rp-project')).toHaveValue('smoke')
    await expect(page.locator('#rp-all-projects')).not.toBeChecked()
  } finally {
    await closeApp(app)
  }
})

test('arrow keys walk the sidebar list and fold projects', async () => {
  const sandbox = createSandbox()
  const now = Date.now()
  const kept = ['First', 'Second'].map((title, i) => ({
    projectId: 'smoke',
    agent: 'claude',
    sessionId: `00000000-0000-4000-8000-00000000020${i}`,
    title,
    closedAt: now - (2 - i) * 1_000
  }))
  writeSettings(sandbox, { keptSessions: kept })
  const { app, page } = await launchApp(sandbox)
  try {
    await openQuietProject(page)
    await page.locator('#sidebar-project-filter').focus()
    await page.keyboard.press('ArrowDown')
    expect(await focusedNav(page)).toBe('p:smoke')
    await page.keyboard.press('ArrowDown')
    expect(await focusedNav(page)).toBe('ct:smoke')
    await page.keyboard.press('ArrowUp')
    expect(await focusedNav(page)).toBe('p:smoke')
    await page.keyboard.press('End')
    expect(await focusedNav(page)).toBe('p:gone')
    await page.keyboard.press('Home')
    expect(await focusedNav(page)).toBe('p:smoke')

    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('button', { name: 'Show sessions for Smoke' })).toHaveAttribute('aria-expanded', 'false')
    expect(await focusedNav(page)).toBe('p:smoke')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('button', { name: 'Hide sessions for Smoke' })).toBeVisible()
    expect(await focusedNav(page)).toBe('p:smoke')
  } finally {
    await closeApp(app)
  }
})

test('dragging works in Name and Recent sort: it switches to Manual, says so and keeps the order after a restart', async () => {
  const sandbox = createSandbox()
  seedThreeProjects(sandbox)
  writeSettings(sandbox, { sidebarSort: 'name' })
  let session = await launchApp(sandbox)
  try {
    const { page } = session
    await expect(projectNames(page)).toHaveText(['Missing', 'Other', 'Smoke'])
    await expect(page.locator('.proj-row.reorderable').first()).toBeVisible()
    expect(await page.locator('.proj-row .proj-toggle').first().evaluate((node) => getComputedStyle(node).cursor)).toBe('grab')
    await dragProject(page, 'Smoke', 'Missing', 'drop')
    await expect(projectNames(page)).toHaveText(['Smoke', 'Missing', 'Other'])
    await expect(page.getByText('Switched to your own order, starting from this list. Your earlier order was replaced.')).toBeVisible()
    await expect.poll(() => readSettings(sandbox.userData).sidebarSort).toBe('manual')
    await expect.poll(() => readSettings(sandbox.userData).projects.map((p: any) => p.id)).toEqual(['smoke', 'gone', 'other'])
  } finally {
    await closeApp(session.app)
  }
  session = await launchApp(sandbox)
  try {
    await expect(projectNames(session.page)).toHaveText(['Smoke', 'Missing', 'Other'])
  } finally {
    await closeApp(session.app)
  }
})

test('a drag cannot cross between pinned and unpinned projects', async () => {
  const sandbox = createSandbox()
  seedThreeProjects(sandbox)
  const { projects } = readSettings(sandbox.userData)
  writeSettings(sandbox, { sidebarSort: 'name', projects: projects.map((p: any) => (p.id === 'other' ? { ...p, pinned: true } : p)) })
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(projectNames(page)).toHaveText(['Other', 'Missing', 'Smoke'])
    await dragProject(page, 'Smoke', 'Other', 'hold')
    await expect(page.locator('.proj-row.drop-before, .proj-row.drop-after')).toHaveCount(0)
    await page.mouse.up()
    await expect(projectNames(page)).toHaveText(['Other', 'Missing', 'Smoke'])
    expect(readSettings(sandbox.userData).sidebarSort).toBe('name')
  } finally {
    await closeApp(app)
  }
})

test('Alt+Up and Alt+Down move the focused project and switch to Manual', async () => {
  const sandbox = createSandbox()
  seedThreeProjects(sandbox)
  writeSettings(sandbox, { sidebarSort: 'name' })
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(projectNames(page)).toHaveText(['Missing', 'Other', 'Smoke'])
    await page.locator('[data-nav="p:smoke"]').focus()
    await page.keyboard.press('Alt+ArrowUp')
    await expect(projectNames(page)).toHaveText(['Missing', 'Smoke', 'Other'])
    await expect.poll(() => readSettings(sandbox.userData).sidebarSort).toBe('manual')
    expect(await focusedNav(page)).toBe('p:smoke')
    await page.keyboard.press('Alt+ArrowDown')
    await expect(projectNames(page)).toHaveText(['Missing', 'Other', 'Smoke'])
    await expect.poll(() => readSettings(sandbox.userData).projects.map((p: any) => p.id)).toEqual(['gone', 'other', 'smoke'])
  } finally {
    await closeApp(app)
  }
})

test('rail monograms can be dragged to reorder', async () => {
  const sandbox = createSandbox()
  seedThreeProjects(sandbox)
  writeSettings(sandbox, { sidebarSort: 'name', sidebarCollapsed: true })
  const { app, page } = await launchApp(sandbox)
  try {
    const monos = page.locator('.rail-mono')
    await expect(monos).toHaveCount(3)
    const source = (await monos.nth(2).boundingBox())!
    const target = (await monos.nth(0).boundingBox())!
    await page.mouse.move(source.x + 10, source.y + 10)
    await page.mouse.down()
    await page.mouse.move(source.x + 12, source.y - 6, { steps: 3 })
    await page.mouse.move(target.x + 10, target.y + 10, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => readSettings(sandbox.userData).projects.map((p: any) => p.id)).toEqual(['smoke', 'gone', 'other'])
    await expect.poll(() => readSettings(sandbox.userData).sidebarSort).toBe('manual')
  } finally {
    await closeApp(app)
  }
})
