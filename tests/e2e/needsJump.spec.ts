import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, feedTerminal, lastInput, launchApp } from './helpers'

const PROMPT = ['  npm run migrate -- --env dev', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')

async function addPanes(page: Page, count: number): Promise<void> {
  for (let index = await page.locator('.pane').count(); index < count; index += 1) {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(index + 1, { timeout: 20_000 })
  }
}

// ConPTY redraws a screen when panes are resized, so the prompt is fed again until every asked pane shows it at once.
async function askPermission(page: Page, ...panes: number[]): Promise<void> {
  await expect(async () => {
    for (const pane of panes) {
      const target = page.locator('.pane').nth(pane)
      const termId = (await target.locator('.term-host').first().getAttribute('data-term-id')) ?? ''
      await feedTerminal(page, termId, '\r\n' + PROMPT)
    }
    for (const pane of panes) await expect(page.locator('.pane').nth(pane)).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
  }).toPass({ timeout: 30_000 })
}

test('Ctrl+Shift+J jumps to the next pane that needs you, cycles through them, and is a palette command and in the shortcuts sheet', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchApp(createSandbox())
  try {
    await addPanes(page, 3)
    await askPermission(page, 0, 1)
    await expect(page.locator('#needs-chip')).toContainText('2 needs you')
    await expect(page.locator('.pane.focused')).toHaveCount(1)
    await expect(page.locator('.pane').nth(2)).toHaveClass(/focused/)

    // Plain Ctrl+J stays Claude Code's newline: it reaches the terminal and does not jump.
    const focusedId = (await page.locator('.pane').nth(2).locator('.term-host').first().getAttribute('data-term-id')) ?? ''
    await page.locator('.pane').nth(2).locator('.term-host.active').click()
    await page.keyboard.press('Control+j')
    await expect.poll(() => lastInput(page, focusedId)).toBe('\n')
    await expect(page.locator('.pane').nth(2)).toHaveClass(/focused/)

    await page.keyboard.press('Control+Shift+J')
    await expect(page.locator('.pane').nth(0)).toHaveClass(/focused/)
    await expect(page.locator('#needs-chip')).toContainText('1 needs you')
    await page.keyboard.press('Control+Shift+J')
    await expect(page.locator('.pane').nth(1)).toHaveClass(/focused/)

    await askPermission(page, 0, 2)
    await page.keyboard.press('Control+Shift+J')
    await expect(page.locator('.pane').nth(2)).toHaveClass(/focused/)
    await askPermission(page, 0)
    await page.keyboard.press('Control+Shift+J')
    await expect(page.locator('.pane').nth(0)).toHaveClass(/focused/)

    await page.locator('.pane').nth(2).locator('.pane-title, .term-host').first().click()
    await askPermission(page, 1)
    await page.keyboard.press('Control+k')
    await page.locator('#palette-input').fill('next pane that needs you')
    await expect(page.getByRole('option', { name: /Jump to the next pane that needs you/ })).toContainText('Ctrl+Shift+J')
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane').nth(1)).toHaveClass(/focused/)

    await page.keyboard.press('Control+/')
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(sheet.getByRole('listitem').filter({ hasText: 'Jump to the next pane that needs you' }).locator('kbd')).toHaveText('Ctrl+Shift+J')
  } finally {
    await closeApp(app)
  }
})
