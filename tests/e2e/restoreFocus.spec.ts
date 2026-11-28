import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

async function openPanes(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Control+n')
    const picker = page.locator('.quickpick:not(.leaving)')
    await expect(picker.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
    await expect(picker.locator('.nd-start')).toBeEnabled()
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(index + 1, { timeout: 20_000 })
  }
}

const focusedPaneId = (page: Page): Promise<string | null> => page.locator('.pane.focused').first().getAttribute('data-pane-id')

// Leaving full screen keeps you in the session you were looking at: it is the focused pane, with the cursor in its terminal.
test('restoring to the grid focuses the pane you were in, whichever tab you switched to', async () => {
  test.setTimeout(90_000)
  const { app, page } = await launchApp(createSandbox())
  try {
    await openPanes(page, 3)
    const ids = await page.locator('.pane').evaluateAll((panes) => panes.map((pane) => (pane as HTMLElement).dataset.paneId ?? ''))
    await page.locator(`.pane[data-pane-id="${ids[0]}"] .pane-title`).click()
    await page.locator(`.pane[data-pane-id="${ids[0]}"]`).getByRole('button', { name: 'Maximize pane' }).click()
    await expect(page.locator('.pane.maximized')).toHaveCount(1)

    // Switch to the last session from the tab strip, then leave full screen with the header button.
    await page.locator(`.pane-strip .strip-tab[data-pane-id="${ids[2]}"] .strip-label`).click()
    await expect(page.locator(`.pane.maximized[data-pane-id="${ids[2]}"]`)).toHaveCount(1)
    await page.locator(`.pane[data-pane-id="${ids[2]}"]`).getByRole('button', { name: 'Restore pane to grid' }).click()
    await expect(page.locator('.pane.maximized')).toHaveCount(0)
    await expect.poll(() => focusedPaneId(page)).toBe(ids[2])
    await expect(page.locator(`.pane[data-pane-id="${ids[2]}"] .term-host.active .xterm-helper-textarea`)).toBeFocused()

    // The same with Esc from the tab strip.
    await page.locator(`.pane[data-pane-id="${ids[1]}"] .pane-title`).click()
    await page.locator(`.pane[data-pane-id="${ids[1]}"]`).getByRole('button', { name: 'Maximize pane' }).click()
    await page.locator(`.pane-strip .strip-tab[data-pane-id="${ids[0]}"] .strip-label`).click()
    await expect(page.locator(`.pane.maximized[data-pane-id="${ids[0]}"]`)).toHaveCount(1)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Escape')
    await expect(page.locator('.pane.maximized')).toHaveCount(0)
    await expect.poll(() => focusedPaneId(page)).toBe(ids[0])
    await expect(page.locator(`.pane[data-pane-id="${ids[0]}"] .term-host.active .xterm-helper-textarea`)).toBeFocused()
  } finally {
    await closeApp(app)
  }
})
