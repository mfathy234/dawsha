import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const SCREENS = 'test-results/screens'
const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
const writeSettings = (sandbox: Sandbox, patch: Record<string, unknown>): void =>
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ ...readSettings(sandbox.userData), ...patch }), 'utf8')

async function startGemini(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Choose agent for Smoke' }).click()
  await page.getByRole('menuitem', { name: 'Gemini session' }).click()
}
const openRow = (page: Page) => page.locator('.kept-session-row:not(.closed)').first()
const focusedNav = (page: Page): Promise<string | undefined> => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.nav)

// A Gemini pane counts as working while it prints, so closing it may ask first.
async function closeFirstPane(page: Page): Promise<void> {
  await page.locator('.pane').first().getByRole('button', { name: 'Close pane' }).click()
  const confirm = page.getByRole('alertdialog').locator('[data-confirm]')
  if (await confirm.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false)) await confirm.click()
}

async function pickTag(page: Page, menuButton: string, item: string, role: 'menuitemradio' | 'menuitem' = 'menuitemradio'): Promise<void> {
  await openRow(page).hover()
  await page.getByRole('button', { name: menuButton }).click()
  await page.getByRole(role, { name: item }).click()
}

test('a session tag follows the session: sidebar, pane header, board card, close, reopen and restart', async () => {
  const sandbox = createSandbox()
  let session = await launchApp(sandbox)
  try {
    const { page } = session
    await startGemini(page)
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane-tag')).toBeHidden()

    await pickTag(page, 'Actions for Smoke in Smoke', 'Tag as Bug')
    await expect(openRow(page)).toHaveAttribute('data-tag', 'bug')
    await expect(openRow(page).locator('.tag-chip')).toHaveText('Bug')
    await expect(page.locator('.pane-tag .tag-chip')).toHaveText('Bug')
    expect(await focusedNav(page)).toMatch(/^s:/)

    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Tag…' }).click()
    await expect(page.getByRole('menuitemradio', { name: 'Tag as Bug' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('menuitemradio', { name: 'Tag as Review' }).click()
    await expect(page.locator('.pane-tag .tag-chip')).toHaveText('Review')
    await expect(openRow(page)).toHaveAttribute('data-tag', 'review')
    await expect.poll(() => readSettings(sandbox.userData).workspace.panes[0].tabs[0].tag).toBe('review')
    mkdirSync(SCREENS, { recursive: true })
    await page.locator('.pane-header').first().screenshot({ path: join(SCREENS, '162-sidebar-pane-header-tag.png') })

    await page.locator('#layout-board').click()
    await expect(page.locator('.board-card .tag-chip')).toHaveText('Review')
    await page.locator('.board-view').screenshot({ path: join(SCREENS, '162-sidebar-board-card-tag.png') })
    await page.locator('#layout-grid').click()

    await closeFirstPane(page)
    await expect(page.locator('.pane')).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox.userData).keptSessions[0]?.tag).toBe('review')
    const closed = page.locator('.kept-session-row.closed')
    await expect(closed).toHaveAttribute('data-tag', 'review')
    await expect(closed.locator('.tag-chip')).toHaveText('Review')

    await closed.locator('.sess-row').click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane-tag .tag-chip')).toHaveText('Review')
  } finally {
    await closeApp(session.app)
  }
  session = await launchApp(sandbox)
  try {
    const { page } = session
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane-tag .tag-chip')).toHaveText('Review')
    await expect(openRow(page)).toHaveAttribute('data-tag', 'review')

    await pickTag(page, 'Actions for Smoke in Smoke', 'Remove tag', 'menuitem')
    await expect(page.locator('.pane-tag')).toBeHidden()
    await expect(openRow(page)).not.toHaveAttribute('data-tag', /.+/)
    await expect.poll(() => readSettings(sandbox.userData).workspace.panes[0].tabs[0].tag).toBeUndefined()
  } finally {
    await closeApp(session.app)
  }
})

test('closed sessions take a tag from their menu and a right click opens it', async () => {
  const sandbox = createSandbox()
  const id = '00000000-0000-4000-8000-000000000301'
  writeSettings(sandbox, { keptSessions: [{ projectId: 'smoke', agent: 'claude', sessionId: id, title: 'Plan the release', closedAt: Date.now() - 5_000 }] })
  const { app, page } = await launchApp(sandbox)
  try {
    const row = page.locator('.kept-session-row.closed')
    await row.locator('.sess-row').click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Actions for Plan the release' })
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitemradio', { name: 'Tag as Docs' }).click()
    await expect(row).toHaveAttribute('data-tag', 'docs')
    await expect.poll(() => readSettings(sandbox.userData).keptSessions[0].tag).toBe('docs')
    expect(await focusedNav(page)).toBe(`c:claude:${id}`)
    await row.hover()
    await page.getByRole('button', { name: 'Actions for Plan the release in Smoke' }).click()
    await page.getByRole('menuitem', { name: 'Remove tag' }).click()
    await expect(row).not.toHaveAttribute('data-tag', /.+/)
    await expect.poll(() => readSettings(sandbox.userData).keptSessions[0].tag).toBeUndefined()
  } finally {
    await closeApp(app)
  }
})

test('a session takes its tag from the branch, a manual tag wins, and the setting hides the colours', async () => {
  const sandbox = createSandbox()
  const git = (...args: string[]): void => void execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: sandbox.projectFolder })
  git('init', '-q', '-b', 'feature/x')
  writeFileSync(join(sandbox.projectFolder, 'a.txt'), 'a', 'utf8')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  const { app, page } = await launchApp(sandbox)
  try {
    await startGemini(page)
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane-tag .tag-chip')).toHaveText('Feature')
    await expect(page.locator('.pane-tag .tag-chip')).toHaveAttribute('title', 'Tag: Feature (from the branch)')
    await expect(openRow(page)).toHaveAttribute('data-tag', 'feature')
    await expect(openRow(page).locator('.tag-chip')).toHaveText('Feature')

    await openRow(page).hover()
    await page.getByRole('button', { name: 'Actions for Smoke in Smoke' }).click()
    await expect(page.getByRole('menuitemradio', { checked: true })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Remove tag' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await pickTag(page, 'Actions for Smoke in Smoke', 'Tag as Bug')
    await expect(page.locator('.pane-tag .tag-chip')).toHaveText('Bug')
    await expect(page.locator('.pane-tag .tag-chip')).toHaveAttribute('title', 'Tag: Bug')

    await page.keyboard.press('Control+Shift+P')
    await page.keyboard.type('Toggle tag colours')
    await page.keyboard.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('data-tag-colors', 'off')
    await expect(page.locator('.pane-tag .tag-chip')).toBeHidden()
    await expect(openRow(page).locator('.tag-chip')).toBeHidden()
    await expect.poll(() => readSettings(sandbox.userData).colorSessionsByTag).toBe(false)
  } finally {
    await closeApp(app)
  }
})

for (const [theme, name] of [['dawsha-night', 'dark'], ['dawsha-daylight', 'light']] as const) {
  test(`tags, cost and the reopen affordance look right in the ${name} theme`, async () => {
    const sandbox = createSandbox()
    const now = Date.now()
    const date = new Date()
    const day = (days: number): number => new Date(date.getFullYear(), date.getMonth(), date.getDate() - days, 12).getTime()
    const kept = [
      ['Fix the invoice export', 'bug', now - 60_000],
      ['Add a dark mode toggle', 'feature', now - 3_600_000],
      ['Review the auth change', 'review', now - 7_200_000],
      ['Compare SQL drivers', 'research', day(1)],
      ['Update the README', 'docs', day(1)],
      ['Untagged scratch session', undefined, day(4)]
    ].map(([title, tag, closedAt], i) => ({ projectId: 'smoke', agent: 'claude', sessionId: `00000000-0000-4000-8000-00000000040${i}`, title, closedAt, ...(tag ? { tag } : {}) }))
    writeSettings(sandbox, { keptSessions: kept })
    const { app, page } = await launchApp(sandbox)
    try {
      if (theme === 'dawsha-daylight') {
        await page.locator('#theme-button').click()
        await page.locator('#theme-dawsha-daylight').click()
        await page.keyboard.press('Escape')
      }
      await startGemini(page)
      await pickTag(page, 'Actions for Smoke in Smoke', 'Tag as Feature')
      await page.getByRole('button', { name: 'Show all 6' }).click()
      await page.locator('.closed-day-row').first().hover()
      mkdirSync(SCREENS, { recursive: true })
      await page.locator('.sidebar').screenshot({ path: join(SCREENS, `162-sidebar-tags-${name}.png`) })
      await expect(page.getByRole('button', { name: 'Reopen 3 sessions from Today in Smoke' })).toBeVisible()
      await page.locator('.pane-header').first().screenshot({ path: join(SCREENS, `162-sidebar-pane-tag-${name}.png`) })
    } finally {
      await closeApp(app)
    }
  })
}
