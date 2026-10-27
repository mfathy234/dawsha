import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, launchApp, type Sandbox } from './helpers'

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
  writeSettings(sandbox, { projects: [...projects, { id: 'other', name: 'Other', folder: other }] })
}

async function openMenu(page: Page, name: string) {
  await page.getByRole('button', { name: `Choose agent for ${name}` }).click()
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
    await expect(smoke.locator('.rail-badge')).toHaveText('1')
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
  const { app, page } = await launchApp(sandbox)
  try {
    const button = page.getByRole('button', { name: 'Choose agent for Smoke' })
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
    expect(await focusedItem()).toBe('Move down')
    await page.keyboard.press('Home')
    expect(await focusedItem()).toContain('Claude session')
    await page.keyboard.press('End')
    expect(await focusedItem()).toBe('Move down')

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(button).toBeFocused()

    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(menu).toHaveCount(0)
    await expect(button).toBeFocused()

    await page.keyboard.press('Enter')
    await page.keyboard.press('End')
    await page.keyboard.press('Space')
    await expect(projectNames(page)).toHaveText(['Missing', 'Smoke'])
    expect(await focusedNav(page)).toBe('p:smoke')

    await page.getByRole('button', { name: 'Choose agent for Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Pin to top' }).press('Enter')
    await expect(projectNames(page)).toHaveText(['Smoke', 'Missing'])
    expect(await focusedNav(page)).toBe('p:smoke')
  } finally {
    await closeApp(app)
  }
})

// A Gemini pane counts as working while it prints, so closing it may ask first.
async function closeFirstPane(page: Page): Promise<void> {
  await page.locator('.pane').first().getByRole('button', { name: 'Close pane' }).click()
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

test('F2 and double click rename closed and open sessions; Enter and blur save, Esc and empty cancel', async () => {
  const sandbox = createSandbox()
  const now = Date.now()
  writeSettings(sandbox, {
    keptSessions: ['Alpha', 'Beta'].map((title, i) => ({ projectId: 'smoke', agent: 'claude', sessionId: KEPT_ID(i), title, closedAt: now - (2 - i) * 1_000 }))
  })
  let session = await launchApp(sandbox)
  try {
    const { page } = session
    const names = page.locator('.kept-session-row.closed .sess-name')
    await expect(names).toHaveText(['Beta', 'Alpha'])

    await page.locator(`[data-nav="c:claude:${KEPT_ID(1)}"]`).dblclick()
    const field = page.getByRole('textbox', { name: 'Rename Beta' })
    await expect(field).toBeFocused()
    await expect(field).toHaveAttribute('dir', 'auto')
    await expect(page.locator('.pane')).toHaveCount(0)
    mkdirSync(SCREENS, { recursive: true })
    await page.locator('.sidebar').screenshot({ path: join(SCREENS, '162-sidebar-rename.png') })
    await field.fill('Beta renamed')
    await page.keyboard.press('Enter')
    await expect(names).toHaveText(['Beta renamed', 'Alpha'])
    expect(await focusedNav(page)).toBe(`c:claude:${KEPT_ID(1)}`)
    await expect.poll(() => readSettings(sandbox.userData).keptSessions.find((s: any) => s.sessionId === KEPT_ID(1))).toMatchObject({ title: 'Beta renamed', renamed: true })

    await page.locator(`[data-nav="c:claude:${KEPT_ID(0)}"]`).focus()
    await page.keyboard.press('F2')
    await page.getByRole('textbox', { name: 'Rename Alpha' }).fill('Never saved')
    await page.keyboard.press('Escape')
    await expect(names).toHaveText(['Beta renamed', 'Alpha'])
    expect(await focusedNav(page)).toBe(`c:claude:${KEPT_ID(0)}`)

    await page.keyboard.press('F2')
    await page.getByRole('textbox', { name: 'Rename Alpha' }).fill('   ')
    await page.keyboard.press('Enter')
    await expect(names).toHaveText(['Beta renamed', 'Alpha'])

    await page.keyboard.press('F2')
    await page.getByRole('textbox', { name: 'Rename Alpha' }).fill('عنوان الجلسة')
    await page.getByRole('textbox', { name: 'Filter projects and sessions' }).focus()
    await expect(names).toHaveText(['Beta renamed', 'عنوان الجلسة'])

    await page.getByRole('button', { name: 'Choose agent for Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Gemini session' }).click()
    const open = page.locator('.kept-session-row:not(.closed) .sess-row')
    await expect(open.locator('.sess-name')).toHaveText('Smoke')
    await open.focus()
    await page.keyboard.press('F2')
    const openField = page.getByRole('textbox', { name: 'Rename Smoke' })
    await openField.fill('x'.repeat(200))
    await expect(openField).toHaveValue('x'.repeat(160))
    await openField.fill('Release notes')
    await page.keyboard.press('Enter')
    await expect(open.locator('.sess-name')).toHaveText('Release notes')
    await expect(page.locator('.pane-title')).toContainText('Release notes')
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.[0]?.tabs?.[0]?.name).toBe('Release notes')

    await closeFirstPane(page)
    await expect(page.locator('.pane')).toHaveCount(0)
    await expect(names.first()).toHaveText('Release notes')
    await expect.poll(() => readSettings(sandbox.userData).keptSessions.some((s: any) => s.title === 'Release notes' && s.renamed === true)).toBe(true)
    await page.locator('.kept-session-row.closed', { hasText: 'Release notes' }).locator('.sess-row').click()
    await expect(page.locator('.pane-title')).toContainText('Release notes')
  } finally {
    await closeApp(session.app)
  }
  session = await launchApp(sandbox)
  try {
    await expect(session.page.locator('.pane-title')).toContainText('Release notes')
  } finally {
    await closeApp(session.app)
  }
})

test('a session row keeps time and cost on their own line and the close button stays hidden until hover', async () => {
  const sandbox = createSandbox()
  const now = Date.now()
  writeSettings(sandbox, {
    sidebarWidth: 208,
    keptSessions: [{ projectId: 'smoke', agent: 'claude', sessionId: KEPT_ID(0), title: 'Trial of a rather long session name', closedAt: now - 33 * 60_000 }]
  })
  writeFileSync(join(sandbox.userData, 'usage-history.json'), JSON.stringify({ v: 1, limits: [], costs: { [KEPT_ID(0)]: { at: now - 1000, usd: 8.69, cwd: sandbox.projectFolder } } }), 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    const row = page.locator('.kept-session-row.closed')
    const cost = row.locator('.sess-cost')
    await expect(cost).toHaveText('$8.69', { timeout: 20_000 })
    const close = row.locator('.sess-close')
    await expect(close).toHaveCSS('opacity', '0')
    const name = (await row.locator('.sess-name').boundingBox())!
    const meta = (await row.locator('.sess-meta').boundingBox())!
    expect(meta.y).toBeGreaterThanOrEqual(name.y + name.height - 1)
    await row.hover()
    await expect(close).toHaveCSS('opacity', '1')
    const costBox = (await cost.boundingBox())!
    const closeBox = (await close.boundingBox())!
    expect(costBox.x + costBox.width).toBeLessThanOrEqual(closeBox.x)
    mkdirSync(SCREENS, { recursive: true })
    await page.locator('.sidebar').screenshot({ path: join(SCREENS, '17-sidebar-rows.png') })
  } finally {
    await closeApp(app)
  }
})

test('Reopen all brings a day of closed sessions back, asking first when it is a crowd', async () => {
  const sandbox = createSandbox()
  const now = Date.now()
  const date = new Date()
  const yesterday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 12).getTime()
  const items = [
    ['One', now - 4_000], ['Two', now - 3_000], ['Three', now - 2_000], ['Old A', yesterday], ['Old B', yesterday - 1_000]
  ] as const
  writeSettings(sandbox, {
    keptSessions: items.map(([title, closedAt], i) => ({ projectId: 'smoke', agent: 'claude', sessionId: KEPT_ID(i), title, closedAt }))
  })
  const { app, page } = await launchApp(sandbox)
  try {
    const today = page.getByRole('button', { name: 'Reopen 3 sessions from Today in Smoke' })
    const older = page.getByRole('button', { name: 'Reopen 2 sessions from Yesterday in Smoke' })
    await expect(today).toHaveCount(1)
    await expect(older).toHaveCount(1)
    await page.locator('.closed-day-row').first().hover()
    mkdirSync(SCREENS, { recursive: true })
    await page.locator('.sidebar').screenshot({ path: join(SCREENS, '162-sidebar-reopen-all.png') })

    await older.click()
    await expect(page.locator('.pane')).toHaveCount(2)
    await expect(page.locator('.kept-session-row.closed .sess-name')).toHaveText(['Three', 'Two', 'One'])
    expect(await page.locator('.kept-session-row:not(.closed) .sess-name').count()).toBe(2)

    await today.click()
    await expect(page.locator('.pane')).toHaveCount(5)
    await expect(page.locator('.kept-session-row.closed')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }

  const crowd = createSandbox()
  writeSettings(crowd, {
    keptSessions: [0, 1, 2, 3, 4].map((i) => ({ projectId: 'smoke', agent: 'claude', sessionId: KEPT_ID(i), title: `Crowd ${i}`, closedAt: Date.now() - (5 - i) * 1_000 }))
  })
  const second = await launchApp(crowd)
  try {
    const { page } = second
    await page.getByRole('button', { name: 'Reopen 5 sessions from Today in Smoke' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Reopen 5 sessions in Smoke?')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.pane')).toHaveCount(0)
    await page.getByRole('button', { name: 'Reopen 5 sessions from Today in Smoke' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reopen 5 sessions' }).click()
    await expect(page.locator('.pane')).toHaveCount(5, { timeout: 30_000 })
  } finally {
    await closeApp(second.app)
  }
})

test('arrow keys walk the sidebar list, fold projects and remove closed sessions with an undo', async () => {
  const sandbox = createSandbox()
  const now = Date.now()
  const kept = ['First', 'Second', 'Third'].map((title, i) => ({
    projectId: 'smoke',
    agent: 'claude',
    sessionId: `00000000-0000-4000-8000-00000000020${i}`,
    title,
    closedAt: now - (3 - i) * 1_000
  }))
  writeSettings(sandbox, { keptSessions: kept })
  const { app, page } = await launchApp(sandbox)
  try {
    const key = (i: number): string => `c:claude:00000000-0000-4000-8000-00000000020${i}`
    const filter = page.getByRole('textbox', { name: 'Filter projects and sessions' })
    await filter.focus()
    await filter.fill('')
    await page.keyboard.press('ArrowDown')
    expect(await focusedNav(page)).toBe('p:smoke')
    await page.keyboard.press('ArrowDown')
    expect(await focusedNav(page)).toBe('ct:smoke')
    await page.keyboard.press('ArrowDown')
    expect(await focusedNav(page)).toBe(key(2))
    await page.keyboard.press('ArrowUp')
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

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    expect(await focusedNav(page)).toBe(key(1))
    await page.keyboard.press('Delete')
    await expect(page.locator('.kept-session-row.closed .sess-name')).toHaveText(['Third', 'First'])
    expect(await focusedNav(page)).toBe(key(0))
    const toast = page.locator('.toast', { hasText: 'Removed Second' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(page.locator('.kept-session-row.closed .sess-name')).toHaveText(['Third', 'Second', 'First'])

    await page.locator('[data-nav="p:smoke"]').focus()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowUp')
    expect(await focusedNav(page)).toBe(key(0))
    await page.keyboard.press('Backspace')
    await expect(page.locator('.kept-session-row.closed .sess-name')).toHaveText(['Third', 'Second'])
    expect(await focusedNav(page)).toBe(key(1))
  } finally {
    await closeApp(app)
  }
})
