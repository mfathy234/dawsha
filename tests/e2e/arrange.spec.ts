import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openTerminalPicker, QUIT_BUDGET_MS } from './helpers'

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

const paneIds = (page: Page): Promise<string[]> =>
  page.locator('.pane').evaluateAll((panes) => panes.map((pane) => (pane as HTMLElement).dataset.paneId ?? ''))

const center = async (locator: Locator): Promise<{ x: number; y: number }> => {
  const box = await locator.boundingBox()
  if (!box) throw new Error('No box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, release = true): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 })
  await page.mouse.move(to.x, to.y, { steps: 6 })
  if (release) await page.mouse.up()
}

const widthOf = async (locator: Locator): Promise<number> => (await locator.boundingBox())?.width ?? 0
const heightOf = async (locator: Locator): Promise<number> => (await locator.boundingBox())?.height ?? 0

test('resizes columns with a draggable gutter, keeps the size, and resets on double click', async () => {
  const sandbox = createSandbox()
  const first = await launchApp(sandbox)
  let savedWidth = 0
  try {
    const { page } = first
    await openPanes(page, 2)
    const panes = page.locator('.pane')
    const gutter = page.locator('.gutter[data-axis="cols"]')
    await expect(gutter).toHaveCount(1)
    await expect(gutter).toHaveAttribute('role', 'separator')
    await expect(gutter).toHaveAttribute('aria-orientation', 'vertical')
    await expect(gutter).toHaveAttribute('aria-valuenow', '57')
    await expect(page.locator('.gutter[data-axis="rows"]')).toHaveCount(0)
    const equalWidth = await widthOf(panes.last())

    const start = await center(gutter)
    await drag(page, start, { x: start.x + 80, y: start.y })
    await expect.poll(async () => widthOf(panes.last())).toBeGreaterThan(equalWidth + 50)
    await expect(gutter).not.toHaveAttribute('aria-valuenow', '57')
    await expect
      .poll(() => readSettings(sandbox.userData).workspace?.splits?.['2x1b']?.cols?.[0] ?? 0)
      .toBeGreaterThan(0.55)

    const now = await center(gutter)
    await drag(page, now, { x: now.x + 3000, y: now.y })
    await expect.poll(async () => widthOf(panes.first())).toBeGreaterThanOrEqual(255)
    expect(await widthOf(panes.first())).toBeLessThan(300)

    await gutter.dblclick()
    await expect.poll(async () => Math.abs((await widthOf(panes.last())) - equalWidth)).toBeLessThan(3)
    await expect(gutter).toHaveAttribute('aria-valuenow', '57')
    await expect.poll(() => readSettings(sandbox.userData).workspace?.splits).toBeUndefined()

    await gutter.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await widthOf(panes.last())) - equalWidth).toBeGreaterThan(30)
    await page.keyboard.press('ArrowLeft')
    expect(Number(await gutter.getAttribute('aria-valuenow'))).toBeGreaterThan(57)
    await expect
      .poll(() => readSettings(sandbox.userData).workspace?.splits?.['2x1b']?.cols?.[0] ?? 0)
      .toBeGreaterThan(0.5)
    savedWidth = await widthOf(panes.last())

    await panes.last().locator('.maximize').click()
    await expect(page.locator('.gutters')).toBeHidden()
    await panes.last().locator('.maximize').click()
    await expect(page.locator('.gutters')).toBeVisible()
  } finally {
    expect(await closeApp(first.app)).toBeLessThan(QUIT_BUDGET_MS)
  }

  const second = await launchApp(sandbox)
  try {
    const panes = second.page.locator('.pane')
    await expect(panes).toHaveCount(2, { timeout: 20_000 })
    await expect.poll(async () => Math.abs((await widthOf(panes.last())) - savedWidth)).toBeLessThan(4)
  } finally {
    expect(await closeApp(second.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('resizes rows in a two by two grid and shows no gutters in the scrolling layout', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openPanes(page, 4)
    const panes = page.locator('.pane')
    const rowGutter = page.locator('.gutter[data-axis="rows"]').first()
    await expect(page.locator('.gutter[data-axis="rows"]')).toHaveCount(2)
    await expect(rowGutter).toHaveAttribute('aria-orientation', 'horizontal')
    await expect(page.locator('.gutter[data-axis="cols"]')).toHaveCount(1)
    const equalHeight = await heightOf(panes.first())
    const start = await center(rowGutter)
    await drag(page, start, { x: start.x, y: start.y + 90 })
    await expect.poll(async () => heightOf(panes.first())).toBeGreaterThan(equalHeight + 60)
    await expect
      .poll(() => readSettings(sandbox.userData).workspace?.splits?.['2x3b']?.rows?.[0] ?? 0)
      .toBeGreaterThan(0.36)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('pins a pane so it stays beside a maximized pane, one pin at a time, and keeps it after a restart', async () => {
  const sandbox = createSandbox()
  const first = await launchApp(sandbox)
  try {
    const { page } = first
    await openPanes(page, 3)
    const ids = await paneIds(page)
    const pane = (index: number): Locator => page.locator(`.pane[data-pane-id="${ids[index]}"]`)

    await pane(0).getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Pin pane' }).click()
    await expect(pane(0).locator('.pane-pin')).toBeVisible()
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.[0]?.pinned).toBe(true)

    await pane(1).locator('.maximize').click()
    await expect(pane(1)).toBeVisible()
    await expect(pane(0)).toBeVisible()
    await expect(pane(2)).toBeHidden()
    const gridWidth = (await page.locator('.grid').boundingBox())?.width ?? 1
    const sideWidth = await widthOf(pane(0))
    expect(sideWidth / gridWidth).toBeGreaterThan(0.25)
    expect(sideWidth / gridWidth).toBeLessThan(0.36)
    expect(await widthOf(pane(1))).toBeGreaterThan(sideWidth * 1.5)

    await pane(0).locator('.pane-header').click({ position: { x: 150, y: 20 } })
    await expect(pane(1)).toBeVisible()
    await expect(pane(0)).toBeVisible()
    await expect(page.locator('.pane.maximized')).toHaveCount(1)
    await expect(pane(1)).toHaveClass(/maximized/)

    await pane(1).locator('.maximize').click()
    await expect(pane(2)).toBeVisible()

    await page.keyboard.press('Control+k')
    await page.keyboard.type('Pin or unpin')
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane-pin:visible')).toHaveCount(1)
    await expect(pane(0).locator('.pane-pin')).toBeHidden()
    await expect
      .poll(() => readSettings(sandbox.userData).workspace?.panes?.map((p: any) => p.pinned === true))
      .toEqual([false, true, false])

    await pane(1).getByRole('button', { name: 'Pane actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Unpin pane' })).toBeVisible()
    await page.keyboard.press('Escape')

    await pane(2).locator('.maximize').click()
    await expect(pane(1)).toBeVisible()
    await expect(pane(0)).toBeHidden()
  } finally {
    expect(await closeApp(first.app)).toBeLessThan(QUIT_BUDGET_MS)
  }

  const second = await launchApp(sandbox)
  try {
    await expect(second.page.locator('.pane')).toHaveCount(3, { timeout: 20_000 })
    await expect(second.page.locator('.pane-pin:visible')).toHaveCount(1)
    await expect(second.page.locator('.pane').nth(1).locator('.pane-pin')).toBeVisible()
    await second.page.locator('.pane').first().locator('.maximize').click()
    await expect(second.page.locator('.pane').nth(1)).toBeVisible()
    await expect(second.page.locator('.pane').nth(2)).toBeHidden()
  } finally {
    expect(await closeApp(second.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('drags a pane by its header onto another pane to reorder, and Esc cancels', async () => {
  const sandbox = createSandbox()
  const first = await launchApp(sandbox)
  try {
    const { page } = first
    await openPanes(page, 3)
    const ids = await paneIds(page)
    const pane = (index: number): Locator => page.locator(`.pane[data-pane-id="${ids[index]}"]`)
    await openTerminalPicker(pane(0))
    await page.getByRole('menuitem', { name: 'Shell' }).click()
    await expect(pane(0).locator('.tabs [role="tab"]')).toHaveCount(2)
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.[0]?.tabs?.length).toBe(2)

    const grip = await center(pane(0).locator('.pane-title'))
    const target = await center(pane(2).locator('.pane-body'))
    await drag(page, grip, target, false)
    await expect(pane(2)).toHaveClass(/drop-target/)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(page.locator('.drop-target')).toHaveCount(0)
    expect(await paneIds(page)).toEqual(ids)

    await drag(page, grip, target)
    await expect.poll(() => paneIds(page)).toEqual([ids[1], ids[2], ids[0]])
    await expect(page.locator('.drop-target')).toHaveCount(0)
    await expect
      .poll(() => readSettings(sandbox.userData).workspace?.panes?.map((p: any) => p.tabs.length))
      .toEqual([1, 1, 2])

    const buttonStart = await center(pane(1).getByRole('button', { name: 'Pane actions' }))
    await drag(page, buttonStart, await center(pane(2).locator('.pane-body')))
    expect(await paneIds(page)).toEqual([ids[1], ids[2], ids[0]])
    await page.keyboard.press('Escape')
  } finally {
    expect(await closeApp(first.app)).toBeLessThan(QUIT_BUDGET_MS)
  }

  const second = await launchApp(sandbox)
  try {
    await expect(second.page.locator('.pane')).toHaveCount(3, { timeout: 20_000 })
    await expect(second.page.locator('.pane').nth(2).locator('.tabs [role="tab"]')).toHaveCount(2)
  } finally {
    expect(await closeApp(second.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('drags terminal tabs to reorder them inside a pane and keeps the active tab', async () => {
  const sandbox = createSandbox()
  const first = await launchApp(sandbox)
  try {
    const { page } = first
    await openPanes(page, 1)
    for (const name of ['Shell', 'Codex session']) {
      await openTerminalPicker(page.locator('.pane').first())
      await page.getByRole('menuitem', { name }).click()
    }
    const tabs = page.locator('.tabs [role="tab"]')
    await expect(tabs).toHaveCount(3)
    const labels = await tabs.allTextContents()
    await tabs.nth(1).click()
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.[0]?.activeIndex).toBe(1)

    const from = await center(tabs.nth(2))
    const to = await center(tabs.nth(0))
    await drag(page, from, to, false)
    await expect(page.locator('.tab.drop-target')).toHaveCount(1)
    await page.mouse.up()
    await expect(page.locator('.tab.drop-target')).toHaveCount(0)
    await expect(tabs).toHaveText([labels[2], labels[0], labels[1]])
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false')
    await expect
      .poll(() => readSettings(sandbox.userData).workspace?.panes?.[0]?.tabs?.map((t: any) => t.agent))
      .toEqual(['codex', 'claude', 'shell'])
    expect(readSettings(sandbox.userData).workspace.panes[0].activeIndex).toBe(2)

    const again = await center(tabs.nth(0))
    await drag(page, again, await center(tabs.nth(2)), false)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(tabs).toHaveText([labels[2], labels[0], labels[1]])
  } finally {
    expect(await closeApp(first.app)).toBeLessThan(QUIT_BUDGET_MS)
  }

  const second = await launchApp(sandbox)
  try {
    const tabs = second.page.locator('.tabs [role="tab"]')
    await expect(tabs).toHaveCount(3, { timeout: 20_000 })
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true')
  } finally {
    expect(await closeApp(second.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
