import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, QUIT_BUDGET_MS } from './helpers'

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

async function openPanes(page: Page, count: number): Promise<void> {
  const existing = await page.locator('.pane').count()
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press('Control+n')
    const picker = page.locator('.quickpick:not(.leaving)')
    await expect(picker.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
    await expect(picker.locator('.nd-start')).toBeEnabled()
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(existing + index + 1, { timeout: 20_000 })
  }
}

const paneIds = (page: Page): Promise<string[]> =>
  page.locator('.pane').evaluateAll((panes) => panes.map((pane) => (pane as HTMLElement).dataset.paneId ?? ''))

test('pins a session from its menus: it heads the sidebar and the tabs, and stays pinned after a restart', async () => {
  const sandbox = createSandbox()
  const first = await launchApp(sandbox)
  let ids: string[] = []
  try {
    const { page } = first
    await openPanes(page, 3)
    ids = await paneIds(page)
    await expect(page.locator('.pinned-group')).toHaveCount(0)

    const row = page.locator(`.sess-row[data-nav="s:${ids[2]}"]`)
    await row.locator('xpath=..').hover()
    await row.locator('xpath=..').getByRole('button', { name: /^Actions for .* in Smoke$/ }).click()
    await page.getByRole('menuitem', { name: 'Pin to top' }).click()

    const group = page.locator('.pinned-group')
    await expect(group).toHaveCount(1)
    await expect(group.locator('.sess-row')).toHaveCount(1)
    await expect(group.locator('.sess-row')).toHaveAttribute('data-nav', `s:${ids[2]}`)
    await expect(group.locator('.sess-pin')).toBeVisible()
    await expect(page.locator('.kept-session-row:not(.pinned-row) .sess-row')).toHaveCount(2)
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.map((p: any) => p.starred === true)).toEqual([true, false, false])
    await expect.poll(async () => (await paneIds(page))[0]).toBe(ids[2])

    await page.locator(`.pane[data-pane-id="${ids[0]}"] .maximize`).click()
    const strip = page.locator('.pane-strip .strip-tab')
    await expect(strip).toHaveCount(3)
    await expect(strip.first()).toHaveAttribute('data-pane-id', ids[2])
    await expect(strip.first().locator('.strip-pin')).toBeVisible()
    await expect(page.locator('.pane-strip .strip-pin')).toHaveCount(1)

    await strip.nth(1).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin to top' }).click()
    await expect(page.locator('.pane-strip .strip-pin')).toHaveCount(2)
    await expect(strip.nth(1)).toHaveAttribute('data-pane-id', ids[0])
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.map((p: any) => p.starred === true)).toEqual([true, true, false])

    await strip.first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Unpin' }).click()
    await expect(page.locator('.pane-strip .strip-pin')).toHaveCount(1)
    await expect(strip.first()).toHaveAttribute('data-pane-id', ids[0])

    const pane = page.locator(`.pane[data-pane-id="${ids[1]}"]`)
    await page.locator('.pane.maximized .maximize').click()
    await expect(page.locator('.pinned-group .sess-row')).toHaveCount(1)
    await pane.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Pin to top' }).click()
    await expect(page.locator('.pinned-group .sess-row')).toHaveCount(2)
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.map((p: any) => p.starred === true)).toEqual([true, true, false])
  } finally {
    expect(await closeApp(first.app)).toBeLessThan(QUIT_BUDGET_MS)
  }

  const second = await launchApp(sandbox)
  try {
    await expect(second.page.locator('.pane')).toHaveCount(3, { timeout: 20_000 })
    await expect(second.page.locator('.pinned-group .sess-row')).toHaveCount(2)
    await expect(second.page.locator('.pinned-group .sess-pin')).toHaveCount(2)
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.map((p: any) => p.starred === true)).toEqual([true, true, false])

    const pinnedRow = second.page.locator('.pinned-group .kept-session-row').first()
    await pinnedRow.hover()
    await pinnedRow.getByRole('button', { name: /^Actions for .* in Smoke$/ }).click()
    await second.page.getByRole('menuitem', { name: 'Unpin' }).click()
    await expect(second.page.locator('.pinned-group .sess-row')).toHaveCount(1)
  } finally {
    expect(await closeApp(second.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
