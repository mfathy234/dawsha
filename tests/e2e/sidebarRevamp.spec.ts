import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, launchApp, type Sandbox } from './helpers'

const SCREENS = 'test-results/screens'
const NEW_IN_SMOKE = /^New (Claude|Codex|Gemini) session in Smoke$/
const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
const writeSettings = (sandbox: Sandbox, patch: Record<string, unknown>): void =>
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ ...readSettings(sandbox.userData), ...patch }), 'utf8')
const smokeRow = (page: Page) => page.locator('.proj-row', { hasText: 'Smoke' })

function git(folder: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: folder, stdio: 'ignore' })
}

async function makeNeedsYou(page: Page): Promise<string> {
  const pane = page.locator('.pane').first()
  const id = (await pane.locator('.term-host.active').getAttribute('data-term-id'))!
  // Wait for the real shell's prompt first: on Windows, ConPTY repaints the screen when the shell starts and would wipe a prompt fed earlier.
  await expect.poll(async () => (await bufferText(page, id)).replace(/\n/g, '').trimEnd(), { timeout: 30_000 }).toMatch(/[>$#%]$/)
  await expect(async () => {
    await feedTerminal(page, id, ['● Bash(npm run migrate)', 'Do you want to proceed?', '1. Yes', '3. No, and tell Claude what to do differently', ''].join('\r\n'))
    await expect.poll(() => bufferText(page, id), { timeout: 1500 }).toContain('1. Yes')
    await expect(pane).toHaveAttribute('data-attention', 'needs', { timeout: 1500 })
  }).toPass({ timeout: 15_000 })
  return id
}

test('project rows are a name and state dots, fold on click and remember it; + and the menu appear on hover', async () => {
  const sandbox = createSandbox()
  git(sandbox.projectFolder, 'init', '-q')
  writeFileSync(join(sandbox.projectFolder, 'a.txt'), 'one\n', 'utf8')
  git(sandbox.projectFolder, 'add', '.')
  git(sandbox.projectFolder, 'commit', '-q', '-m', 'init')
  git(sandbox.projectFolder, 'checkout', '-q', '-b', 'feat/sidebar')
  let session = await launchApp(sandbox)
  try {
    const { page } = session
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    const row = smokeRow(page)
    await expect(row.locator('.proj-branch')).toHaveCount(0)
    await expect(row.locator('.proj-dots')).toHaveCount(0)
    await expect(page.locator('.sess-row').first()).toHaveAttribute('title', /Branch feat\/sidebar/)
    await page.locator('.pane .pane-title').first().click()
    await page.mouse.move(700, 500)
    await expect(row.locator('.proj-acts')).toHaveCSS('opacity', '0')
    await row.hover()
    await expect(row.locator('.proj-acts')).toHaveCSS('opacity', '1')
    await expect(row.getByRole('button', { name: 'Project actions for Smoke' })).toBeVisible()

    await expect(page.locator('.sess-row')).toHaveCount(1)
    await row.locator('.proj-toggle').click()
    await expect(row.locator('.proj-toggle')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.sess-row')).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox.userData).foldedProjects).toEqual(['smoke'])
  } finally {
    await closeApp(session.app)
  }
  session = await launchApp(sandbox)
  try {
    await expect(smokeRow(session.page).locator('.proj-toggle')).toHaveAttribute('aria-expanded', 'false')
  } finally {
    await closeApp(session.app)
  }
})

test('session rows keep the full title and a status word, and drop the tag, branch and a meaningless time', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    const row = page.locator('.kept-session-row:not(.closed) .sess-row').first()
    await expect(row.locator('.sess-age')).toHaveCount(0)
    await expect(row.locator('.sess-state-word')).toHaveText(/^(Working|Idle|Needs you|Done)/)
    await expect(row.locator('.tag-word')).toHaveCount(0)
    const name = await row.locator('.sess-name').textContent()
    await expect(row).toHaveAttribute('title', new RegExp(`^${name!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  } finally {
    await closeApp(app)
  }
})

test('Needs you lists sessions that need input once, says what they ask, and disappears when none do', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(page.getByRole('region', { name: 'Needs you' })).toHaveCount(0)
    const add = page.getByRole('button', { name: NEW_IN_SMOKE })
    await add.click()
    await add.click()
    await expect(page.locator('.pane')).toHaveCount(2)
    await page.locator('.pane').nth(1).locator('.pane-title').click()
    await makeNeedsYou(page)
    const waiting = page.getByRole('region', { name: 'Needs you' })
    await expect(waiting).toBeVisible()
    await expect(waiting.locator('.side-sec-count')).toHaveText('1')
    await expect(waiting.locator('.needs-row')).toHaveCount(1)
    await expect(waiting.locator('.needs-project')).toHaveText('Smoke')
    await expect(waiting.locator('.needs-t')).toHaveText('Run npm run migrate?')
    await expect(page.locator('.proj-row', { hasText: 'Smoke' }).locator('.proj-dots')).toHaveAttribute('aria-label', '1 needs you')
    const dimmed = page.locator('.kept-session-row.dimmed')
    await expect(dimmed).toHaveCount(1)
    await expect(dimmed).toContainText('Waiting, listed above')
    await page.locator('.sidebar').screenshot({ path: join(SCREENS, 'sidebar-waiting.png') })
    await waiting.locator('.needs-row').click()
    await expect(page.getByRole('region', { name: 'Needs you' })).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('an open project menu stays open and usable while the sidebar re-renders', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const add = page.getByRole('button', { name: NEW_IN_SMOKE })
    await add.click()
    await add.click()
    await expect(page.locator('.pane')).toHaveCount(2)
    await page.locator('.pane').nth(1).locator('.pane-title').click()
    await page.getByRole('button', { name: 'Project actions for Smoke' }).click()
    const menu = page.getByRole('menu', { name: 'Actions for Smoke' })
    await expect(menu).toBeVisible()
    await makeNeedsYou(page)
    await expect(page.getByRole('region', { name: 'Needs you' })).toBeVisible()
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Open in Files' }).click()
    await expect(page.locator('#files-view')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('sort and hide-empty are remembered, and the filter opens from the keyboard', async () => {
  const sandbox = createSandbox()
  let session = await launchApp(sandbox)
  try {
    const { page } = session
    const names = page.locator('.proj-list .proj-name')
    await expect(names).toHaveText(['Smoke', 'Missing'])
    await page.getByRole('button', { name: 'Sort and filter projects' }).click()
    await expect(page.getByRole('menuitemradio', { name: 'Recent activity' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('menuitemradio', { name: 'Name' }).click()
    await expect(names).toHaveText(['Missing', 'Smoke'])
    await expect.poll(() => readSettings(sandbox.userData).sidebarSort).toBe('name')

    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await page.getByRole('button', { name: 'Sort and filter projects' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Hide projects without sessions' }).click()
    await expect.poll(() => readSettings(sandbox.userData).sidebarHideEmpty).toBe(true)
    await expect(page.locator('.proj-list .proj-name', { hasText: 'Missing' })).toHaveCount(0)

    const find = page.locator('#sidebar-project-filter')
    await expect(find).toHaveAttribute('placeholder', /^Find( a session)?$/)
    await expect(page.locator('.sb-find-hint')).toHaveText('Ctrl+K')
    await page.locator('.pane .pane-title').first().click()
    await page.keyboard.press('Control+Shift+O')
    await expect(find).toBeFocused()
    await find.fill('smo')
    await expect(names).toHaveText(['Smoke'])
    await page.keyboard.press('Escape')
    await expect(find).toHaveValue('')
    await expect(find).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(find).not.toBeFocused()
  } finally {
    await closeApp(session.app)
  }
  session = await launchApp(sandbox)
  try {
    expect(readSettings(sandbox.userData)).toMatchObject({ sidebarSort: 'name', sidebarHideEmpty: true })
    await expect(session.page.locator('.sidebar-note')).toContainText('without sessions hidden')
  } finally {
    await closeApp(session.app)
  }
})

test('the project menu ends with Remove, which names the project and keeps the folder', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'Project actions for Missing' }).click()
    const menu = page.getByRole('menu', { name: 'Actions for Missing' })
    const items = menu.getByRole('menuitem')
    await expect(items.last()).toHaveText('Remove Missing from Dawsha…')
    await items.last().click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Remove Missing?')
    await expect(dialog).toContainText('The folder stays on disk')
    await expect(dialog.getByRole('button', { name: 'Remove Missing' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.proj-name', { hasText: 'Missing' })).toBeVisible()

    await page.getByRole('button', { name: 'Project actions for Missing' }).click()
    await page.getByRole('menuitem', { name: 'Remove Missing from Dawsha…' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove Missing' }).click()
    await expect(page.locator('.proj-name', { hasText: 'Missing' })).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox.userData).projects.map((p: any) => p.id)).toEqual(['smoke'])
  } finally {
    await closeApp(app)
  }
})

test('the rail shows monograms and opens a flyout with the full session names', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    const title = (await page.locator('.sess-row .sess-name').first().textContent())!.trim()
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    const rail = page.locator('.sidebar.rail')
    await expect(rail).toBeVisible()
    expect(await rail.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(56)
    await expect(rail.getByRole('button', { name: 'Smoke', exact: true }).locator('.rail-letters')).toHaveText('SM')
    await rail.getByRole('button', { name: /^Smoke/ }).click()
    const flyout = page.getByRole('menu', { name: 'Sessions in Smoke' })
    await expect(flyout).toBeVisible()
    await expect(flyout.locator('.fly-title').first()).toHaveText(title)
    await expect(flyout.getByRole('menuitem', { name: /New (Claude|Codex|Gemini) session/ })).toBeVisible()
    await rail.screenshot({ path: join(SCREENS, 'sidebar-rail-flyout.png') })
    await page.keyboard.press('Escape')
    await expect(flyout).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('projects keep one list: sessions first, projects without sessions say so, closed sessions fold into one line', async () => {
  const sandbox = createSandbox()
  const base = readSettings(sandbox.userData).projects as { id: string; name: string; folder: string }[]
  const extra = ['Alpha', 'Beta', 'Gamma'].map((name) => ({ id: name.toLowerCase(), name, folder: join(sandbox.root, name) }))
  const kept = [0, 1, 2].map((i) => ({ projectId: 'smoke', agent: 'claude', sessionId: `00000000-0000-4000-8000-00000000020${i}`, title: `Earlier ${i}`, closedAt: Date.now() - (i + 1) * 60_000 }))
  writeSettings(sandbox, { projects: [...base, ...extra.map((item, i) => (i === 0 ? { ...item, pinned: true } : item))], keptSessions: kept })
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(page.locator('.side-sec-label').first()).toHaveText('Projects')
    await expect(page.locator('.quiet-sec')).toHaveCount(0)
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.proj-group.card .proj-name')).toHaveText('Smoke')
    await expect(page.locator('.proj-group.zone-pinned .proj-name')).toHaveText('Alpha')
    const quiet = page.locator('.proj-group.zone-quiet .proj-row.quiet-row')
    await expect(quiet.locator('.proj-name')).toHaveText(['Missing', 'Beta', 'Gamma'])
    await expect(quiet.locator('.proj-none')).toHaveText(['no sessions', 'no sessions', 'no sessions'])
    expect((await quiet.first().boundingBox())!.height).toBeLessThan(36)
    await expect(page.locator('.proj-group.zone-quiet .sess-row')).toHaveCount(0)

    await expect(page.locator('.closed-line')).toHaveText('3 closed today')
    await expect(page.locator('.kept-session-row.closed')).toHaveCount(0)
    await quiet.first().locator('.quiet-toggle').click()
    await expect(page.locator('.proj-group.zone-quiet').first().locator('.proj-toggle')).toHaveAttribute('aria-expanded', 'true')
  } finally {
    await closeApp(app)
  }
})
