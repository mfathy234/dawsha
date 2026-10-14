import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, fontSize, launchApp } from './helpers'

const NEW_IN_SMOKE = /^New (Claude|Codex|Gemini) session in Smoke$/

test('top bar text size buttons resize every pane, and the label follows the focused pane', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const add = page.getByRole('button', { name: NEW_IN_SMOKE })
    for (let i = 0; i < 3; i++) await add.click()
    await expect(page.locator('.pane')).toHaveCount(3)
    const ids = await page.locator('.pane .term-host.active').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.termId!))
    const sizes = (): Promise<number[]> => Promise.all(ids.map((id) => fontSize(page, id)))
    const label = page.locator('.zoom-value')
    await expect.poll(sizes).toEqual([15, 15, 15])

    // Give the first pane its own size, the way Ctrl+= does.
    await page.locator('.pane').nth(0).locator('.term-host.active').click()
    await page.keyboard.press('Control+=')
    await page.keyboard.press('Control+=')
    await expect.poll(sizes).toEqual([17, 15, 15])
    await expect(label).toHaveText('17px')

    await expect(page.getByRole('button', { name: 'Increase font size' })).toHaveAttribute('title', /every pane/)
    await page.getByRole('button', { name: 'Increase font size' }).click()
    await expect.poll(sizes).toEqual([18, 16, 16])
    await expect(label).toHaveText('18px')

    await page.getByRole('button', { name: 'Decrease font size' }).click()
    await page.getByRole('button', { name: 'Decrease font size' }).click()
    await expect.poll(sizes).toEqual([16, 14, 14])

    await page.locator('.pane').nth(2).locator('.term-host.active').click()
    await expect(label).toHaveText('14px')
  } finally {
    await closeApp(app)
  }
})
