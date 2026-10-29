import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const NEAR = 14

async function boxOf(locator: Locator): Promise<{ left: number; right: number; top: number; bottom: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('no box')
  return { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height }
}

async function expectPlaced(page: Page, trigger: Locator, label: string): Promise<void> {
  const menu = page.locator('.popover:visible').last()
  await expect(menu, label).toBeVisible()
  await page.waitForTimeout(250)
  const view = page.viewportSize() as { width: number; height: number }
  const m = await boxOf(menu)
  const t = await boxOf(trigger)
  expect(m.left, `${label}: left edge inside the window`).toBeGreaterThanOrEqual(0)
  expect(m.top, `${label}: top edge inside the window`).toBeGreaterThanOrEqual(0)
  expect(m.right, `${label}: right edge inside the window`).toBeLessThanOrEqual(view.width + 0.5)
  expect(m.bottom, `${label}: bottom edge inside the window`).toBeLessThanOrEqual(view.height + 0.5)
  const startAligned = Math.abs(m.left - t.left) <= NEAR
  const endAligned = Math.abs(m.right - t.right) <= NEAR
  const pinnedToEdge = m.left <= 8.5 || m.right >= view.width - 8.5
  expect(startAligned || endAligned || pinnedToEdge, `${label}: menu ${Math.round(m.left)}-${Math.round(m.right)} vs trigger ${Math.round(t.left)}-${Math.round(t.right)}`).toBe(true)
  const touches = m.right > t.left && m.left < t.right && m.bottom > t.top && m.top < t.bottom
  expect(touches, `${label}: menu does not cover its trigger`).toBe(false)
  await page.keyboard.press('Escape')
  await expect(menu, `${label}: closes`).toHaveCount(0)
}

test('the main menus and popovers open aligned to their trigger and inside the 1024x728 window', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })

    const projectMenu = page.getByRole('button', { name: 'Project actions for Smoke' })
    await projectMenu.click()
    await expectPlaced(page, projectMenu, 'sidebar project menu (left edge)')

    const sort = page.getByRole('button', { name: 'Sort and filter projects' })
    await sort.click()
    await expectPlaced(page, sort, 'sidebar sort menu')

    const chevron = page.locator('#new-session-agent')
    await chevron.click()
    await expectPlaced(page, page.locator('.topbar .split'), 'New session menu')

    const more = page.locator('#more-button')
    await more.click()
    await expectPlaced(page, more, 'top bar More menu')

    const layouts = page.locator('#layouts-button')
    await layouts.click()
    await expectPlaced(page, layouts, 'layouts popover')

    const pane = page.getByRole('button', { name: 'Pane actions' })
    await pane.click()
    await expectPlaced(page, pane, 'pane actions menu')

    await page.setViewportSize({ width: 1024, height: 460 })
    await pane.click()
    await expectPlaced(page, pane, 'pane actions menu in a short window')
  } finally {
    await closeApp(app)
  }
})
