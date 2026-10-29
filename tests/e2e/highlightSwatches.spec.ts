import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openMore, openSettings } from './helpers'

const SCREENS = 'test-results/screens'
const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

test('highlight colour is a swatch radio group with arrow keys, names, a check and a live preview', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'highlights')
    const group = page.locator('#hl-add-color')
    await expect(group).toHaveAttribute('role', 'radiogroup')
    const radios = group.getByRole('radio')
    await expect(radios).toHaveText(['', '', '', '', ''])
    for (const name of ['Red', 'Amber', 'Green', 'Blue', 'Purple']) await expect(group.getByRole('radio', { name, exact: true })).toBeVisible()
    await expect(group.getByRole('radio', { name: 'Red' })).toHaveAttribute('aria-checked', 'true')
    await expect(group.locator('select')).toHaveCount(0)

    await group.getByRole('radio', { name: 'Red' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(group.getByRole('radio', { name: 'Amber' })).toBeFocused()
    await expect(group.getByRole('radio', { name: 'Amber' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('End')
    await expect(group.getByRole('radio', { name: 'Purple' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(group.getByRole('radio', { name: 'Red' })).toHaveAttribute('aria-checked', 'true')
    await expect(group.getByRole('radio', { name: 'Red' })).toHaveCSS('box-shadow', /.+/)

    const preview = page.locator('#highlight-preview')
    await expect(preview).toBeVisible()
    await expect(preview.locator('.hl-preview-line[data-hl="red"]')).not.toHaveCount(0)
    await expect(preview.locator('.hl-preview-line.draft')).toHaveCount(0)
    await page.locator('#hl-add-pattern').fill('deploy')
    await group.getByRole('radio', { name: 'Purple' }).click()
    await expect(preview.locator('.hl-preview-line.draft')).toHaveAttribute('data-hl', 'purple')
    await page.screenshot({ path: join(SCREENS, 'highlight-swatches.png') })

    await page.locator('#hl-add-submit').click()
    await expect.poll(() => readSettings(sandbox.userData).highlights.rules.at(-1)).toMatchObject({ pattern: 'deploy', color: 'purple' })
  } finally {
    await closeApp(app)
  }
})

test('no visible native select is left without the selectMenu wrapper', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const bare = (): Promise<string[]> =>
      page.evaluate(() =>
        [...document.querySelectorAll('select')]
          .filter((el) => !el.classList.contains('select-menu-native') && el.getClientRects().length > 0)
          .map((el) => el.id || el.getAttribute('aria-label') || el.className)
      )
    expect(await bare()).toEqual([])
    for (const view of ['projects', 'work', 'agents', 'skills'] as const) {
      await openMore(page, view)
      expect(await bare(), view).toEqual([])
    }
    await openMore(page, 'projects')
    await page.getByRole('tab', { name: 'Instructions' }).click()
    await expect(page.locator('#instr-project')).toHaveClass(/select-menu-native/)
    expect(await bare(), 'instructions').toEqual([])
    await page.getByRole('tab', { name: 'Tasks' }).click().catch(() => undefined)
    expect(await bare(), 'tasks').toEqual([])
    for (const section of ['general', 'notifications', 'agents', 'highlights'] as const) {
      await openSettings(page, section)
      expect(await bare(), section).toEqual([])
    }
  } finally {
    await closeApp(app)
  }
})
