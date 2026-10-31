import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, closeApp, closePaneViaActions, createSandbox, feedTerminal, launchApp, type Sandbox } from './helpers'

const CLAUDE_ID = '11111111-2222-4333-8444-555555555555'
const PROMPT = ['  npm test -- invoices', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')
const SCREENS = 'test-results/screens'
const SLOW = 15_000

function writeClaudeSession(sandbox: Sandbox): void {
  const dir = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${CLAUDE_ID}.jsonl`),
    [
      JSON.stringify({ type: 'user', timestamp: '2026-10-08T09:12:00.000Z', message: { content: 'Add a dark mode toggle' } }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Add dark mode toggle' })
    ].join('\n') + '\n'
  )
}

// Pane 1 is a resumed Claude session, pane 2 a fresh one; closing pane 1 raises the "Closed … Reopen" toast.
async function closeFirstPane(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+R')
  await page.locator('.rp-row', { hasText: 'Add dark mode toggle' }).click()
  await expect(page.locator('.pane')).toHaveCount(1)
  await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
  await expect(page.locator('.pane')).toHaveCount(2)
  await closePaneViaActions(page.locator('.pane').first())
  await expect(page.locator('.pane')).toHaveCount(1)
}

// A pane that is focused and in view never asks for attention, so the prompt goes to the first pane while a second one has focus.
async function makeNeedYou(page: Page): Promise<string> {
  await page.locator('#new-session').click()
  await expect(page.locator('.quickpick')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })
  const termId = await page.locator('.pane').first().locator('.term-host').first().getAttribute('data-term-id')
  // The shell may still be printing its banner over the first prompt, so feed it again until the session is noticed.
  await expect(async () => {
    await feedTerminal(page, termId ?? '', PROMPT)
    await expect(page.locator('#notifications-button')).toHaveAttribute('aria-label', 'Notifications, 2 unread', { timeout: 3000 })
  }).toPass({ timeout: SLOW })
  return (await page.locator('.pane').first().getAttribute('data-pane-id')) ?? ''
}

const popover = (page: Page) => page.getByRole('dialog', { name: 'Notifications' })

test('a toast that is gone stays in the history with its action, and opening the bell marks it read', async () => {
  const sandbox = createSandbox()
  writeClaudeSession(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    const bell = page.locator('#notifications-button')
    await expect(bell).toHaveAttribute('aria-label', 'Notifications')
    await closeFirstPane(page)
    const toast = page.locator('.toast')
    await expect(toast).toHaveText('Closed SmokeReopen')
    await toast.getByRole('button', { name: 'Dismiss notification' }).click()
    await expect(toast).toHaveCount(0)
    await expect(bell).toHaveAttribute('aria-label', 'Notifications, 1 unread')
    await expect(bell.locator('.bell-badge')).toHaveText('1')

    await bell.click()
    await expect(popover(page)).toBeVisible()
    await expect(popover(page).getByRole('heading', { name: 'Notifications' })).toBeVisible()
    await expect(bell).toHaveAttribute('aria-label', 'Notifications')
    await expect(bell.locator('.bell-badge')).toBeHidden()
    const item = popover(page).locator('.notification-item')
    await expect(item).toHaveCount(1)
    await expect(item).toContainText('Closed Smoke')
    await expect(item).toContainText('just now')
    await item.getByRole('button', { name: 'Reopen' }).click()
    await expect(popover(page)).toHaveCount(0)
    await expect(page.locator('.pane')).toHaveCount(2)

    // The offer is used up: it stays in the list without a second Reopen.
    await bell.click()
    await expect(popover(page).locator('.notification-item')).toHaveCount(1)
    await expect(popover(page).getByRole('button', { name: 'Reopen' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)
    await expect(bell).toBeFocused()
  } finally {
    await closeApp(app)
  }
})

test('a session that needs you is noted once, Go to session focuses its pane, Clear and Dismiss work', async () => {
  const sandbox = createSandbox()
  writeClaudeSession(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await closeFirstPane(page)
    await page.locator('.toast').getByRole('button', { name: 'Dismiss notification' }).click()
    const paneId = await makeNeedYou(page)
    const bell = page.locator('#notifications-button')

    await expect(page.locator(`.pane[data-pane-id="${paneId}"]`)).not.toHaveClass(/focused/)

    await bell.click()
    const needs = popover(page).locator('.notification-item.kind-needs')
    await expect(needs).toHaveCount(1)
    await expect(needs).toContainText(/ in Smoke needs you/)
    await needs.getByRole('button', { name: 'Go to session' }).click()
    await expect(popover(page)).toHaveCount(0)
    await expect(page.locator(`.pane[data-pane-id="${paneId}"]`)).toHaveClass(/focused/)

    await bell.click()
    await popover(page).getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(popover(page)).toHaveCount(0)
    await expect(bell).toBeFocused()

    await bell.click()
    await page.mouse.click(5, 400)
    await expect(popover(page)).toHaveCount(0)

    await bell.click()
    const before = await popover(page).locator('.notification-item').count()
    await popover(page).getByRole('button', { name: 'Clear' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Clear notifications?' })
    await expect(confirm).toContainText(`This removes ${before} notifications from the list.`)
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(popover(page).locator('.notification-item')).toHaveCount(before)
    await popover(page).getByRole('button', { name: 'Clear' }).click()
    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    await expect(popover(page).locator('.notification-item')).toHaveCount(before)
    await popover(page).getByRole('button', { name: 'Clear' }).click()
    await confirm.getByRole('button', { name: `Clear ${before} notifications` }).click()
    await expect(popover(page)).toBeVisible()
    await expect(popover(page).locator('.notification-item')).toHaveCount(0)
    await expect(popover(page)).toContainText('No notifications yet.')
    await expect(popover(page).getByRole('button', { name: 'Clear' })).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

for (const theme of ['dawsha-night', 'dawsha-daylight']) {
  test(`the bell badge and the open list look right in ${theme}`, async () => {
    const sandbox = createSandbox()
    writeClaudeSession(sandbox)
    writeFileSync(
      join(sandbox.userData, 'settings.json'),
      JSON.stringify({ version: 2, lastSeenVersion: APP_VERSION, theme: { id: theme }, projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }] })
    )
    const { app, page } = await launchApp(sandbox)
    const name = theme === 'dawsha-night' ? 'dark' : 'light'
    try {
      mkdirSync(SCREENS, { recursive: true })
      await closeFirstPane(page)
      // Dismiss the Closed toast now: it times out on its own while the prompt below is being noticed.
      await page.locator('.toast').getByRole('button', { name: 'Dismiss notification' }).click()
      await expect(page.locator('.toast')).toHaveCount(0)
      await makeNeedYou(page)
      const bell = page.locator('#notifications-button')
      await page.locator('.topbar').screenshot({ path: join(SCREENS, `162-notifications-bell-${name}.png`) })
      await bell.click()
      await expect(popover(page)).toBeVisible()
      await page.screenshot({ path: join(SCREENS, `162-notifications-popover-${name}.png`), animations: 'disabled' })
    } finally {
      await closeApp(app)
    }
  })
}
