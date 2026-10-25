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
    await feedTerminal(page, firstId!, ['Do you want to proceed?', '1. Yes', '3. No, and tell Claude what to do differently', ''].join('\r\n'))
    await expect.poll(() => bufferText(page, firstId!), { timeout: 15_000 }).toContain('1. Yes')
    await second.locator('.pane-title').click()
    await expect(first).toHaveAttribute('data-attention', 'needs', { timeout: 15_000 })

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
