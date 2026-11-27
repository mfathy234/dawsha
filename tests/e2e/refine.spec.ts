import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openSettings, closeSettings, activeTermId, bufferText } from './helpers'

test('a maximized terminal uses the full width until the line length limit is turned on', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.setViewportSize({ width: 1800, height: 900 })
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const id = await activeTermId(page)
    await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
    const pane = page.locator('.pane').first()
    if ((await pane.getAttribute('class'))?.includes('maximized') !== true) await pane.getByRole('button', { name: 'Maximize pane' }).click()
    await expect(pane).toHaveClass(/maximized/)
    const host = page.locator('.term-host.active')
    const body = page.locator('.pane-body').first()
    expect(await host.evaluate((el) => (el as HTMLElement).style.maxWidth)).toBe('')

    await openSettings(page, 'general')
    await page.locator('#limit-line-length').click()
    await expect(page.locator('#limit-line-length')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(async () => page.evaluate(async () => (await window.gridApi.getSettings()).settings?.limitLineLength)).toBe(true)
    await closeSettings(page)
    await expect.poll(async () => host.evaluate((el) => (el as HTMLElement).style.maxWidth)).toMatch(/px$/)
    const capped = await host.evaluate((el) => el.getBoundingClientRect().width)
    const room = await body.evaluate((el) => el.getBoundingClientRect().width)
    expect(capped).toBeLessThan(room - 40)
    const cols = await host.evaluate((el) => {
      const screen = el.querySelector('.xterm-screen') as HTMLElement
      return { screen: screen.clientWidth }
    })
    expect(cols.screen).toBeLessThanOrEqual(capped)

    await openSettings(page, 'general')
    await page.locator('#limit-line-length').click()
    await expect(page.locator('#limit-line-length')).toHaveAttribute('aria-checked', 'false')
    await closeSettings(page)
    await expect.poll(async () => host.evaluate((el) => (el as HTMLElement).style.maxWidth)).toBe('')
  } finally {
    await closeApp(app)
  }
})

test('the header is one 36px row and the Reading view button shows only when maximized', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const pane = page.locator('.pane').first()
    await expect(pane.locator('.pane-header')).toBeVisible()
    if ((await pane.getAttribute('class'))?.includes('maximized') === true) await pane.getByRole('button', { name: 'Restore pane to grid' }).click()
    await expect(pane.getByRole('button', { name: /^Reading view/ })).toBeHidden()
    await pane.getByRole('button', { name: 'Maximize pane' }).click()
    await expect(pane.getByRole('button', { name: /^Reading view/ })).toBeVisible()
    expect(await pane.locator('.pane-header').evaluate((el) => el.getBoundingClientRect().height)).toBe(36)
    await expect(pane.locator('.pane-recap')).not.toHaveClass(/expanded/)
  } finally {
    await closeApp(app)
  }
})
