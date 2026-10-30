import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp, QUIT_BUDGET_MS } from './helpers'

const SCREENS = 'test-results/screens'

test('the command palette opens with Ctrl+K, filters across groups and runs commands from the keyboard', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await page.locator('.term-host.active').click()

    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await expect(page.locator('#palette-input')).toBeFocused()
    await expect(page.locator('.palette-group')).toHaveText(['Sessions', 'Actions', 'Projects'])
    await expect(page.locator('.palette-row').first()).toContainText('1 · Smoke')
    await expect(page.locator('.palette-row').first()).toHaveClass(/selected/)
    await page.screenshot({ path: join(SCREENS, '30-palette.png') })

    await page.keyboard.press('Tab')
    await expect(page.locator('.palette-row.selected')).toHaveAttribute('data-command', 'session.new')
    await page.keyboard.press('Shift+Tab')
    await expect(page.locator('.palette-row.selected')).toHaveAttribute('data-command', /^session:/)
    await page.keyboard.press('ArrowUp')
    await expect(page.locator('.palette-row.selected')).toHaveAttribute('data-command', /^project:/)
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.palette-row.selected')).toHaveAttribute('data-command', /^session:/)

    await page.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)
    await expect(page.locator('.term-host.active .xterm-helper-textarea')).toBeFocused()

    await page.locator('#search-button').click()
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('.term-host.active').click()

    await page.keyboard.press('Control+Shift+p')
    await expect(palette).toBeVisible()
    await page.keyboard.press('Control+k')
    await expect(palette).toHaveCount(0)

    await page.keyboard.press('Control+k')
    await expect(page.locator('#palette-input')).toBeFocused()
    await page.keyboard.type('codex smoke')
    await expect(page.locator('.palette-group')).toHaveText(['Projects'])
    await expect(page.locator('.palette-row')).toHaveCount(1)
    await expect(page.locator('.palette-row')).toContainText('Start Codex in Smoke')
    await page.keyboard.press('Enter')
    await expect(palette).toHaveCount(0)
    await expect(page.locator('.pane')).toHaveCount(2)
    await expect(page.locator('.pane-header .agent-mark.codex')).toHaveCount(1)

    await page.keyboard.press('Control+k')
    await expect(page.locator('#palette-input')).toBeFocused()
    await page.keyboard.type('resume')
    await expect(page.locator('.palette-row .palette-match').first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('.resume-picker')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.resume-picker')).toHaveCount(0)

    await page.keyboard.press('Control+k')
    await expect(page.locator('.palette-group').first()).toHaveText('Recent')
    await expect(page.locator('.palette-row').first()).toHaveAttribute('data-command', 'session.resume')
    await page.locator('.palette-row', { hasText: '2 ·' }).click()
    await expect(palette).toHaveCount(0)
    await expect(page.locator('.pane.focused')).toHaveAttribute('data-pane-id', /.+/)

    await page.keyboard.press('Control+k')
    await expect(page.locator('#palette-input')).toBeFocused()
    await page.keyboard.type('zzzzqq')
    await expect(page.locator('.palette-empty')).toHaveText('Nothing matches that.')
    await page.keyboard.press('Enter')
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('the palette shortcut can be changed in settings.json', async () => {
  const sandbox = createSandbox()
  const path = join(sandbox.userData, 'settings.json')
  const stored = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, JSON.stringify({ ...stored, lastSeenVersion: APP_VERSION, paletteShortcut: 'Ctrl+Alt+P' }), 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.keyboard.press('Control+Alt+p')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
    await expect(page.locator('.palette-head .palette-kbd')).toHaveText('Ctrl+Alt+P')
    await page.keyboard.press('Control+Alt+p')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0)
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0)
    await page.keyboard.press('Control+Shift+p')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  } finally {
    await closeApp(app)
  }
})
