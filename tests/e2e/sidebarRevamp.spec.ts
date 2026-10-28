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
  await expect(async () => {
    await feedTerminal(page, id, ['Do you want to proceed?', '1. Yes', '3. No, and tell Claude what to do differently', ''].join('\r\n'))
    await expect.poll(() => bufferText(page, id), { timeout: 1500 }).toContain('1. Yes')
    await expect(pane).toHaveAttribute('data-attention', 'needs', { timeout: 1500 })
  }).toPass({ timeout: 15_000 })
  return id
}

test('project rows show the branch, fold on click and remember it; + and the menu appear on hover', async () => {
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
    await expect(row.locator('.proj-branch')).toHaveText('feat/sidebar')
    await expect(row.locator('.proj-count')).toHaveText('1 live')
    await page.locator('.pane .pane-title').first().click()
    await page.mouse.move(700, 500)
    await expect(row.locator('.proj-acts')).toHaveCSS('opacity', '0')
    await row.hover()
    await expect(row.locator('.proj-acts')).toHaveCSS('opacity', '1')
    await expect(row.locator('.proj-count')).toHaveCSS('opacity', '0')
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

test('session rows keep the full title, show age and a status word, and drop the tag', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: NEW_IN_SMOKE }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    const row = page.locator('.kept-session-row:not(.closed) .sess-row').first()
    await expect(row.locator('.sess-age')).toHaveText(/^(now|\d+m)$/)
    await expect(row.locator('.sess-state-word')).toHaveText(/^(Working|Idle|Needs you|Done)/)
    await expect(row.locator('.tag-word')).toHaveCount(0)
    const name = await row.locator('.sess-name').textContent()
    await expect(row).toHaveAttribute('title', new RegExp(`^${name!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  } finally {
    await closeApp(app)
  }
})

test('Waiting on you lists sessions that need input and disappears when none do', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(page.getByRole('region', { name: 'Waiting on you' })).toHaveCount(0)
    const add = page.getByRole('button', { name: NEW_IN_SMOKE })
    await add.click()
    await add.click()
    await expect(page.locator('.pane')).toHaveCount(2)
    await page.locator('.pane').nth(1).locator('.pane-title').click()
    await makeNeedsYou(page)
    const waiting = page.getByRole('region', { name: 'Waiting on you' })
    await expect(waiting).toBeVisible()
    await expect(waiting.locator('.side-sec-count')).toHaveText('1')
    await expect(waiting.locator('.needs-row')).toHaveCount(1)
    await expect(waiting.locator('.needs-project')).toHaveText('Smoke')
    await expect(page.locator('.proj-row', { hasText: 'Smoke' }).locator('.proj-count')).toHaveText('needs you')
    await page.locator('.sidebar').screenshot({ path: join(SCREENS, 'sidebar-waiting.png') })
    await waiting.locator('.needs-row').click()
    await expect(page.getByRole('region', { name: 'Waiting on you' })).toHaveCount(0)
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

    await expect(page.locator('#sidebar-project-filter')).toHaveCount(0)
    await page.locator('.sidebar-head').click()
    await page.keyboard.press('Control+Shift+O')
    await expect(page.locator('#sidebar-project-filter')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('#sidebar-project-filter')).toHaveCount(0)
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
