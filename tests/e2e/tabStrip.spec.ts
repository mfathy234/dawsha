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
    await expect(picker.locator('input')).toBeFocused()
    await expect(picker.locator('.nd-start')).toBeEnabled()
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(existing + index + 1, { timeout: 20_000 })
  }
}

const order = (page: Page): Promise<string[]> => page.locator('.pane-strip .strip-tab').evaluateAll((tabs) => tabs.map((tab) => (tab as HTMLElement).dataset.paneId ?? ''))
const savedOrder = (userData: string): number => readSettings(userData).workspace?.panes?.length ?? 0

async function dragTab(page: Page, from: number, toX: (first: { x: number; width: number }, last: { x: number; width: number }) => number, release = true): Promise<void> {
  const tabs = page.locator('.pane-strip .strip-tab')
  const start = (await tabs.nth(from).boundingBox())!
  const first = (await tabs.first().boundingBox())!
  const last = (await tabs.last().boundingBox())!
  const y = start.y + start.height / 2
  await page.mouse.move(start.x + start.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(start.x + start.width / 2 + 20, y, { steps: 4 })
  await page.mouse.move(toX(first, last), y, { steps: 8 })
  if (release) await page.mouse.up()
}

test('drag a session tab to a new place, Esc cancels, and the new order survives a restart', async () => {
  const sandbox = createSandbox()
  const first = await launchApp(sandbox)
  let expected: string[] = []
  try {
    const { page } = first
    await openPanes(page, 3)
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    const tabs = page.locator('.pane-strip .strip-tab')
    await expect(tabs).toHaveCount(3)
    const [a, b, c] = await order(page)
    // Each pane gets its own text size, so the saved order can be told apart after a restart.
    for (const [index, zooms] of [[1, 1], [2, 2]]) {
      await tabs.nth(index).getByRole('tab').click()
      for (let step = 0; step < zooms; step += 1) await page.keyboard.press('Control+=')
    }
    await tabs.first().getByRole('tab').click()
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.map((pane: any) => pane.fontSize)?.join()).toBe('15,16,17')
    const sizes = readSettings(sandbox.userData).workspace.panes.map((pane: any) => pane.fontSize as number)
    expect(new Set(sizes).size).toBe(3)
    const selected = await page.locator('.pane-strip .strip-tab.selected').getAttribute('data-pane-id')

    // The close button keeps its space: tabs do not move when it appears on hover.
    const second = tabs.nth(1)
    const close = second.getByRole('button', { name: /^Close / })
    const widthBefore = (await second.boundingBox())!.width
    if (selected !== b) expect(await close.evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
    await second.hover()
    await expect(close).toHaveCSS('opacity', '1')
    expect((await second.boundingBox())!.width).toBeCloseTo(widthBefore, 0)
    await page.mouse.move(5, 5)

    // Esc cancels a drag in progress.
    await dragTab(page, 0, (_first, last) => last.x + last.width - 4, false)
    await expect(page.locator('.pane-strip .strip-drop')).toBeVisible()
    await expect(tabs.first()).toHaveClass(/drag-source/)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(page.locator('.pane-strip .strip-drop')).toBeHidden()
    expect(await order(page)).toEqual([a, b, c])

    // Dropping after the last tab moves the first one to the end.
    await dragTab(page, 0, (_first, last) => last.x + last.width - 4)
    await expect.poll(() => order(page)).toEqual([b, c, a])
    await expect.poll(async () => (await page.locator('.pane').evaluateAll((panes) => panes.map((pane) => (pane as HTMLElement).dataset.paneId))).join()).toBe([b, c, a].join())
    expect(await page.locator('.pane-strip .strip-tab.selected').getAttribute('data-pane-id')).toBe(selected)
    await expect.poll(() => savedOrder(sandbox.userData)).toBe(3)
    expected = [sizes[1], sizes[2], sizes[0]] as unknown as string[]
    await expect.poll(() => readSettings(sandbox.userData).workspace.panes.map((pane: any) => pane.fontSize).join()).toBe(expected.join())
  } finally {
    expect(await closeApp(first.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
  expect(expected).toHaveLength(3)

  const second = await launchApp(sandbox)
  try {
    const { page } = second
    await expect(page.locator('.pane')).toHaveCount(3, { timeout: 20_000 })
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    const names = await page.locator('.pane-strip .strip-index').allTextContents()
    expect(names).toEqual(['1', '2', '3'])
    expect(readSettings(sandbox.userData).workspace.panes.map((pane: any) => pane.fontSize).join()).toBe(expected.join())
  } finally {
    expect(await closeApp(second.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('tabs in the Side panel layout drag the same way', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openPanes(page, 3)
    await page.locator('#layout-panel').click()
    await expect(page.locator('.pane-strip .strip-tab')).toHaveCount(3)
    const [a, b, c] = await order(page)
    await dragTab(page, 2, (first) => first.x + 4)
    await expect.poll(() => order(page)).toEqual([c, a, b])
  } finally {
    await closeApp(app)
  }
})
