import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, closePaneViaActions, createSandbox, launchApp, openQuietProject, type Sandbox } from './helpers'

const SCREENS = 'test-results/screens'
const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
const idOf = (i: number): string => `00000000-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`
const daysAgo = (days: number): number => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 12).getTime()
}
const minutesAgo = (minutes: number): number => Date.now() - minutes * 60_000

interface Closed { title: string; when: number }

// Closed sessions are a settings entry plus the transcript the picker lists, so both are written.
function seedClosed(sandbox: Sandbox, closed: Closed[], extra: Record<string, unknown> = {}): void {
  const dir = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  closed.forEach(({ title, when }, i) => {
    const path = join(dir, `${idOf(i)}.jsonl`)
    writeFileSync(path, [
      JSON.stringify({ type: 'user', timestamp: '2026-10-08T09:12:00.000Z', message: { content: `Work on ${title}` } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Done.' }] } }),
      JSON.stringify({ type: 'ai-title', aiTitle: title })
    ].join('\n') + '\n')
    utimesSync(path, new Date(when), new Date(when))
  })
  const keptSessions = closed.map(({ title, when }, i) => ({ projectId: 'smoke', agent: 'claude', sessionId: idOf(i), title, closedAt: when }))
  const settings = readSettings(sandbox.userData)
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ ...settings, keptSessions, ...extra }), 'utf8')
}

async function openClosedPicker(page: Page): Promise<void> {
  await openQuietProject(page)
  await page.locator('.closed-line').click()
  await expect(page.locator('.resume-picker')).toBeVisible()
  await expect(page.locator('#rp-project')).toHaveValue('smoke')
}

const rowFor = (page: Page, title: string) => page.locator('.rp-row', { hasText: title })
const titles = (page: Page) => page.locator('.rp-row .rp-title')
const keptTitles = (sandbox: Sandbox): string[] => readSettings(sandbox.userData).keptSessions.map((k: any) => k.title)

async function openMenu(page: Page, title: string): Promise<void> {
  await rowFor(page, title).hover()
  await page.getByRole('button', { name: `Actions for ${title}`, exact: true }).click()
}

test('a closed session keeps its actions until it is removed from the list', async () => {
  const sandbox = createSandbox()
  seedClosed(sandbox, [{ title: 'Add dark mode toggle', when: minutesAgo(5) }])
  const { app, page } = await launchApp(sandbox)
  try {
    await openClosedPicker(page)
    await expect(page.locator('.rp-more')).toHaveCount(1)
    await openMenu(page, 'Add dark mode toggle')
    await page.screenshot({ path: join(SCREENS, '66-resume-row-menu.png') })
    await page.getByRole('menuitem', { name: 'Remove from list' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Remove Add dark mode toggle from Smoke?')
    await dialog.getByRole('button', { name: 'Remove Add dark mode toggle', exact: true }).click()
    await expect.poll(() => readSettings(sandbox.userData).keptSessions.length).toBe(0)
    await expect(page.locator('.rp-more')).toHaveCount(0)
    await expect(rowFor(page, 'Add dark mode toggle')).toHaveCount(1)
  } finally {
    await closeApp(app)
  }
})

test('a session closed in a pane shows up in the picker with its actions', async () => {
  const sandbox = createSandbox()
  seedClosed(sandbox, [{ title: 'Add dark mode toggle', when: minutesAgo(5) }], { keptSessions: [] })
  const { app, page } = await launchApp(sandbox)
  try {
    await page.keyboard.press('Control+Shift+R')
    await rowFor(page, 'Add dark mode toggle').click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await closePaneViaActions(page.locator('.pane').first())
    await expect(page.locator('.pane')).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox.userData).keptSessions?.length).toBe(1)
    await page.keyboard.press('Control+Shift+R')
    await expect(page.locator('.rp-more')).toHaveCount(1)
  } finally {
    await closeApp(app)
  }
})

test('closed sessions list newest first and clear after a confirm that names the project and count', async () => {
  const sandbox = createSandbox()
  seedClosed(sandbox, Array.from({ length: 7 }, (_, i) => ({ title: `Closed ${i}`, when: minutesAgo(7 - i) })))
  const { app, page } = await launchApp(sandbox)
  try {
    await openClosedPicker(page)
    await expect(titles(page)).toHaveText(['Closed 6', 'Closed 5', 'Closed 4', 'Closed 3', 'Closed 2', 'Closed 1', 'Closed 0'])
    const clear = page.getByRole('button', { name: 'Clear 7 closed in Smoke' })
    await clear.click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(titles(page)).toHaveCount(7)
    await clear.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(titles(page)).toHaveCount(7)
    await clear.click()
    await page.getByRole('button', { name: 'Clear 7 closed sessions in Smoke' }).click()
    await expect.poll(() => readSettings(sandbox.userData).keptSessions.length).toBe(0)
    await expect(clear).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('removing a closed session offers an undo that restores its place', async () => {
  const sandbox = createSandbox()
  seedClosed(sandbox, [{ title: 'First', when: minutesAgo(3) }, { title: 'Second', when: minutesAgo(2) }, { title: 'Third', when: minutesAgo(1) }])
  const { app, page } = await launchApp(sandbox)
  try {
    await openClosedPicker(page)
    await expect(titles(page)).toHaveText(['Third', 'Second', 'First'])
    await openMenu(page, 'Second')
    await page.getByRole('menuitem', { name: 'Remove from list' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove Second', exact: true }).click()
    await expect.poll(() => keptTitles(sandbox)).toEqual(['First', 'Third'])
    const removed = page.locator('.toast', { hasText: 'Removed Second' })
    await expect(removed).toBeVisible()
    await removed.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => keptTitles(sandbox)).toEqual(['First', 'Second', 'Third'])
    await expect(page.locator('.rp-more')).toHaveCount(3)
  } finally {
    await closeApp(app)
  }
})

test('Reopen all starts the closed sessions of one day, and asks first when there are many', async () => {
  const sandbox = createSandbox()
  seedClosed(sandbox, [
    { title: 'Old one', when: daysAgo(10) },
    { title: 'Yesterday a', when: daysAgo(1) },
    { title: 'Yesterday b', when: daysAgo(1) + 60_000 },
    ...Array.from({ length: 5 }, (_, i) => ({ title: `Today ${i}`, when: minutesAgo(i + 1) }))
  ])
  const { app, page } = await launchApp(sandbox)
  try {
    await openClosedPicker(page)
    await expect(page.locator('.rp-group')).toHaveText(['TodayReopen all', 'YesterdayReopen all', 'Older'])
    await page.getByRole('button', { name: 'Reopen 5 closed sessions from Today in Smoke' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Reopen 5 sessions in Smoke?')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.pane')).toHaveCount(0)
    await page.getByRole('button', { name: 'Reopen 2 closed sessions from Yesterday in Smoke' }).click()
    await expect(page.locator('.pane')).toHaveCount(2)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('closed sessions take a tag from their menu and a right click opens it', async () => {
  const sandbox = createSandbox()
  seedClosed(sandbox, [{ title: 'Plan the release', when: minutesAgo(5) }])
  const { app, page } = await launchApp(sandbox)
  try {
    await openClosedPicker(page)
    const row = rowFor(page, 'Plan the release')
    await row.click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Actions for Plan the release' })
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Tag as Docs' }).click()
    await expect(row.locator('.sess-tag')).toHaveText('docs')
    await expect.poll(() => readSettings(sandbox.userData).keptSessions[0].tag).toBe('docs')
    await openMenu(page, 'Plan the release')
    await page.getByRole('menuitem', { name: 'Remove tag' }).click()
    await expect(row.locator('.sess-tag')).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox.userData).keptSessions[0].tag).toBeUndefined()
  } finally {
    await closeApp(app)
  }
})

test('F2 and the menu rename a closed session in place, and Delete removes it after a confirm', async () => {
  const sandbox = createSandbox()
  seedClosed(sandbox, [{ title: 'Alpha run', when: minutesAgo(2) }, { title: 'Beta run', when: minutesAgo(1) }])
  const { app, page } = await launchApp(sandbox)
  try {
    await openClosedPicker(page)
    await expect(rowFor(page, 'Beta run')).toHaveClass(/selected/)
    await page.keyboard.press('F2')
    const field = page.getByRole('textbox', { name: 'Rename Beta run' })
    await expect(field).toBeFocused()
    await field.fill('Gamma run')
    await page.keyboard.press('Escape')
    await expect(page.locator('.resume-picker')).toBeVisible()
    await expect(titles(page).first()).toHaveText('Beta run')
    await page.keyboard.press('F2')
    await page.getByRole('textbox', { name: 'Rename Beta run' }).fill('Gamma run')
    await page.keyboard.press('Enter')
    await expect(titles(page).first()).toHaveText('Gamma run')
    await expect.poll(() => readSettings(sandbox.userData).keptSessions.find((k: any) => k.title === 'Gamma run')?.renamed).toBe(true)

    await openMenu(page, 'Alpha run')
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await page.getByRole('textbox', { name: 'Rename Alpha run' }).fill('Delta run')
    await page.keyboard.press('Enter')
    await expect(titles(page)).toHaveText(['Gamma run', 'Delta run'])

    await page.locator('.rp-search').click()
    await page.keyboard.press('Delete')
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Remove Delta run from Smoke?')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(() => keptTitles(sandbox).length).toBe(2)
    await page.keyboard.press('Delete')
    await dialog.getByRole('button', { name: 'Remove Delta run', exact: true }).click()
    await expect.poll(() => keptTitles(sandbox)).toEqual(['Gamma run'])
  } finally {
    await closeApp(app)
  }
})
