import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, launchApp, QUIT_BUDGET_MS, type Sandbox } from './helpers'

const PROMPT = ['  npm test -- invoices', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')
const CLEAR_SCREEN = '\x1b[2J\x1b[H'

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

function writeSession(sandbox: Sandbox, status: 'busy' | 'idle'): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, 'board-session.json'),
    JSON.stringify({ pid: process.pid, sessionId: 'board-session', cwd: sandbox.projectFolder, name: 'Split the invoice export', nameSource: 'user', status, startedAt: now + 1000, updatedAt: now + 1000 }),
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

const termIdOfPane = async (page: Page, index: number): Promise<string> => {
  const id = await page.locator('.pane').nth(index).locator('.term-host').first().getAttribute('data-term-id')
  if (!id) throw new Error('No terminal in the pane')
  return id
}

const column = (page: Page, id: 'needs' | 'working' | 'done' | 'reviewed') => page.locator(`.board-col-${id}`)

test('sessions board: columns follow state, answer, review, peek, reply, filter and switch back', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openPanes(page, 2)
    const second = await termIdOfPane(page, 1)

    await page.locator('#layout-board').click()
    await expect(page.locator('.board-view')).toBeVisible()
    await expect(page.locator('.grid-area')).toBeHidden()
    await expect(page.locator('#layout-board')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => readSettings(sandbox.userData).sessionsLayout).toBe('board')
    await expect(page.locator('.board-col')).toHaveCount(4)
    await expect(column(page, 'reviewed').locator('.board-card')).toHaveCount(2)
    await expect(column(page, 'needs').locator('.board-empty')).toContainText('Nothing waiting on you.')

    writeSession(sandbox, 'busy')
    await expect(column(page, 'working').locator('.board-card')).toHaveCount(1, { timeout: 15_000 })
    await expect(column(page, 'working').locator('.board-card-title')).toHaveText('Split the invoice export')
    const workingCard = column(page, 'working').locator('.board-card')
    const workingId = await workingCard.getAttribute('data-pane-id')
    await expect(column(page, 'reviewed').locator('.board-card')).toHaveCount(1)

    await feedTerminal(page, second, PROMPT)
    const needsCard = column(page, 'needs').locator('.board-card')
    await expect(needsCard).toHaveCount(1, { timeout: 15_000 })
    await expect(needsCard.locator('.board-card-prompt')).toContainText('npm test -- invoices')
    await expect(column(page, 'reviewed').locator('.board-card')).toHaveCount(0)
    const before = (await bufferText(page, second)).split('\n').filter((line) => />\s*$/.test(line)).length
    await needsCard.getByRole('button', { name: /^Allow for/ }).click()
    await expect.poll(async () => (await bufferText(page, second)).split('\n').filter((line) => />\s*$/.test(line)).length).toBeGreaterThan(before)
    await feedTerminal(page, second, CLEAR_SCREEN)
    await expect(column(page, 'needs').locator('.board-card')).toHaveCount(0, { timeout: 15_000 })
    await expect(column(page, 'reviewed').locator('.board-card')).toHaveCount(1)
    await expect(column(page, 'needs').locator('.board-empty')).toBeVisible()

    writeSession(sandbox, 'idle')
    const doneCard = column(page, 'done').locator('.board-card')
    await expect(doneCard).toHaveCount(1, { timeout: 15_000 })
    await expect(doneCard).toHaveAttribute('data-pane-id', workingId ?? '')
    for (const name of ['Changes', 'Timeline', 'Replay', 'Mark']) await expect(doneCard.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible()
    await doneCard.getByRole('button', { name: /^Mark .* reviewed$/ }).click()
    await expect(column(page, 'done').locator('.board-card')).toHaveCount(0)
    await expect(column(page, 'reviewed').locator('.board-card')).toHaveCount(2)

    writeSession(sandbox, 'busy')
    await expect(column(page, 'working').locator('.board-card')).toHaveCount(1, { timeout: 15_000 })
    writeSession(sandbox, 'idle')
    await expect(column(page, 'done').locator('.board-card')).toHaveCount(1, { timeout: 15_000 })
    await expect(column(page, 'done').locator('.board-card')).toHaveAttribute('draggable', 'true')
    await column(page, 'done').locator('.board-card').dragTo(column(page, 'reviewed'))
    await expect(column(page, 'done').locator('.board-card')).toHaveCount(0)
    await expect(column(page, 'reviewed').locator('.board-card')).toHaveCount(2)

    const peeked = column(page, 'reviewed').locator('.board-card').filter({ has: page.locator('.board-card-title', { hasText: /^Smoke$/ }) })
    await peeked.click()
    const peek = page.locator('.board-peek')
    await expect(peek).toBeVisible()
    await expect(peek.locator(`.term-host[data-term-id="${second}"]`)).toBeVisible()
    await expect(page.locator('.pane .term-host')).toHaveCount(1)
    // A reply is never typed into a permission prompt, where Enter would pick its default answer.
    // The prompt is printed by the pane's own shell, like a real agent would: on Windows the console repaints
    // after the peek resizes it, which would wipe text fed straight into xterm.
    const shell = async (command: string): Promise<void> => {
      await peek.locator('.term-host').click()
      await page.keyboard.type(command)
      await page.keyboard.press('Enter')
    }
    await shell('echo Do you want to proceed? & echo 1. Yes & echo 2. No, and tell Claude what to do differently')
    await expect.poll(async () => /^2\. No, and tell Claude/m.test(await bufferText(page, second))).toBe(true)
    await peek.getByRole('textbox', { name: /^Message to/ }).fill('echo blockedreply')
    await peek.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('.toasts')).toContainText('Answer the permission')
    await expect(peek.getByRole('textbox', { name: /^Message to/ })).toHaveValue('echo blockedreply')
    expect(await bufferText(page, second)).not.toContain('blockedreply')
    await shell('cls')
    await expect.poll(async () => /^2\. No, and tell Claude/m.test(await bufferText(page, second))).toBe(false)
    await expect(column(page, 'needs').locator('.board-card')).toHaveCount(0, { timeout: 15_000 })
    await peek.getByRole('textbox', { name: /^Message to/ }).fill('echo boardreply')
    await peek.getByRole('button', { name: 'Send' }).click()
    await expect.poll(async () => /^boardreply\s*$/m.test(await bufferText(page, second))).toBe(true)
    await expect(peek.getByRole('textbox', { name: /^Message to/ })).toHaveValue('')
    await page.keyboard.press('Escape')
    await expect(peek).toBeHidden()
    await expect(page.locator('.pane .term-host')).toHaveCount(2)

    await page.locator('#new-session-agent').click()
    await page.locator('[data-agent="codex"]').click()
    await expect(page.locator('.quickpick')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(3, { timeout: 20_000 })
    await expect(page.locator('.board-card')).toHaveCount(3)
    const agentChip = page.locator('.board-filters .filter-chip').nth(1)
    await expect(agentChip).toHaveText('Agent: All')
    await agentChip.focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('listbox', { name: 'Agent' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('option', { selected: true })).toHaveText('All agents')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    await expect(agentChip).toHaveText('Agent: Codex')
    await expect(page.locator('.board-card')).toHaveCount(1)
    await expect(page.locator('.board-card')).toHaveAttribute('data-pane-id', (await page.locator('.pane').nth(2).getAttribute('data-pane-id')) ?? '')

    await agentChip.click()
    await expect(page.getByRole('listbox', { name: 'Agent' }).getByRole('option', { selected: true })).toHaveText('Codex')
    await page.keyboard.press('Home')
    await page.keyboard.press('Enter')
    await expect(agentChip).toHaveText('Agent: All')
    await expect(page.locator('.board-card')).toHaveCount(3)

    await page.keyboard.press('Control+Shift+B')
    await expect(page.locator('.board-view')).toBeHidden()
    await expect(page.locator('.grid-area')).toBeVisible()
    await expect(page.locator('#layout-grid')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => readSettings(sandbox.userData).sessionsLayout).toBe('grid')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
