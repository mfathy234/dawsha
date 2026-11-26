import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, launchApp, type Sandbox } from './helpers'

const PROMPT = ['  npm test -- invoices', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
const savedCare = (userData: string): unknown[] => (readSettings(userData).workspace?.panes ?? []).map((pane: any) => pane.care ?? null)

function writeSession(sandbox: Sandbox, status: 'busy' | 'idle'): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, 'inbox-session.json'),
    JSON.stringify({ pid: process.pid, sessionId: 'inbox-session', cwd: sandbox.projectFolder, name: 'Split the invoice export', nameSource: 'user', status, startedAt: now + 1000, updatedAt: now + 1000 }),
    'utf8'
  )
}

async function openPanes(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Control+n')
    await expect(page.locator('.quickpick')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(index + 1, { timeout: 20_000 })
  }
}

const termIdOfPane = async (page: Page, paneId: string): Promise<string> => (await page.locator(`.pane[data-pane-id="${paneId}"] .term-host`).first().getAttribute('data-term-id')) ?? ''

test('a session that finishes unseen stays unread across a restart, and the inbox lists it, answers and marks it read', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openPanes(page, 3)
    writeSession(sandbox, 'busy')
    const working = page.locator('.pane[data-state="working"]')
    await expect(working).toHaveCount(1, { timeout: 20_000 })
    const workingId = (await working.getAttribute('data-pane-id')) ?? ''
    const others = page.locator(`.pane:not([data-pane-id="${workingId}"])`)
    const otherId = (await others.nth(0).getAttribute('data-pane-id')) ?? ''
    // A session is unread only when it finishes while it is not the one in front of you.
    await others.nth(1).locator('.pane-title').click()
    await expect(others.nth(1)).toHaveClass(/focused/)

    writeSession(sandbox, 'idle')
    await expect(page.locator(`.pane[data-pane-id="${workingId}"]`)).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    await expect(page.locator('.sess-row.unread')).toHaveCount(1)
    await expect.poll(() => savedCare(sandbox.userData).filter((care: any) => care?.unread === true).length, { timeout: 15_000 }).toBe(1)

    await page.keyboard.press('Control+i')
    await expect(page.locator('.inbox-view')).toBeVisible()
    await expect(page.locator('.inbox-row')).toHaveCount(1)
    await expect(page.locator('.inbox-row')).toContainText('Done')
    await expect(page.locator('.inbox-summary')).toHaveText('1 unread')

    // Needs-you sessions come first, with their numbered choices.
    await page.keyboard.press('Escape')
    await expect(page.locator('.inbox-view')).toBeHidden()
    const waitingTerm = await termIdOfPane(page, otherId)
    await expect(async () => {
      await feedTerminal(page, waitingTerm, '\r\n' + PROMPT)
      await expect(page.locator(`.pane[data-pane-id="${otherId}"]`)).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
    }).toPass({ timeout: 30_000 })
    await page.keyboard.press('Control+i')
    await expect(page.locator('.inbox-row').first()).toContainText('Needs you')
    await expect(page.locator('.inbox-row')).toHaveCount(2)
    await expect(async () => {
      await feedTerminal(page, waitingTerm, '\r\n' + PROMPT)
      await expect(page.locator('.inbox-choice')).toHaveCount(2, { timeout: 2000 })
    }).toPass({ timeout: 30_000 })
    await expect(page.locator('.inbox-summary')).toHaveText('1 needs you · 1 unread')
    const before = (await bufferText(page, waitingTerm)).split('\n').filter((line) => />\s*$/.test(line)).length
    await page.keyboard.press('1')
    await expect.poll(async () => (await bufferText(page, waitingTerm)).split('\n').filter((line) => />1?\s*$/.test(line)).length).toBeGreaterThan(before - 1)

    await feedTerminal(page, waitingTerm, '\x1b[2J\x1b[H')
    // Arrow keys move, E marks read, and the empty list says so.
    await expect(page.locator('.inbox-row')).toHaveCount(1, { timeout: 20_000 })
    await page.keyboard.press('e')
    await expect(page.locator('.inbox-empty')).toContainText('Nothing needs you.')
    await expect(page.locator('.sess-row.unread')).toHaveCount(0)
    await expect.poll(() => savedCare(sandbox.userData).filter((care: any) => care?.unread === true).length, { timeout: 15_000 }).toBe(0)
  } finally {
    await closeApp(app)
  }
})

test('unread is saved with the workspace and shows after a restart', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox()
  const first = await launchApp(sandbox)
  let workingId = ''
  try {
    await openPanes(first.page, 2)
    writeSession(sandbox, 'busy')
    const working = first.page.locator('.pane[data-state="working"]')
    await expect(working).toHaveCount(1, { timeout: 20_000 })
    workingId = (await working.getAttribute('data-pane-id')) ?? ''
    await first.page.locator(`.pane:not([data-pane-id="${workingId}"]) .pane-title`).click()
    writeSession(sandbox, 'idle')
    await expect(first.page.locator(`.pane[data-pane-id="${workingId}"]`)).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    await expect.poll(() => savedCare(sandbox.userData).filter((care: any) => care?.unread === true).length, { timeout: 15_000 }).toBe(1)
  } finally {
    await closeApp(first.app)
  }
  const second = await launchApp(sandbox)
  try {
    await expect(second.page.locator('.pane')).toHaveCount(2, { timeout: 30_000 })
    await expect(second.page.locator('.sess-row.unread')).toHaveCount(1, { timeout: 20_000 })
    await second.page.keyboard.press('Control+k')
    await second.page.locator('#palette-input').fill('open inbox')
    await expect(second.page.getByRole('option', { name: /Open inbox/ })).toContainText('Ctrl+I')
    await second.page.keyboard.press('Enter')
    await expect(second.page.locator('.inbox-row')).toHaveCount(1)
    await second.page.locator('.inbox-row').click()
    await second.page.keyboard.press('o')
    await expect(second.page.locator('.inbox-view')).toBeHidden()
    await expect(second.page.locator('.sess-row.unread')).toHaveCount(0)
  } finally {
    await closeApp(second.app)
  }
})
