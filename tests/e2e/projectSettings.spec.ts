import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { PROJECT_COLORS } from '../../src/shared/projectColor'
import { closeApp, createSandbox, launchApp } from './helpers'

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
const smoke = (userData: string): any => readSettings(userData).projects?.find((project: any) => project.id === 'smoke')
const SVG = (fill: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/></svg>`

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Manage projects' }).click()
  await page.getByRole('button', { name: 'More for Smoke' }).click()
  await page.getByRole('menuitem', { name: 'Project settings…' }).click()
  await expect(page.getByRole('dialog', { name: 'Project settings' })).toBeVisible()
}

test('Project settings shows where the icon comes from, switches it, and picks a colour', async () => {
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.projectFolder, 'favicon.svg'), SVG('#2255aa'), 'utf8')
  const picked = join(sandbox.root, 'picked.svg')
  writeFileSync(picked, SVG('#aa5522'), 'utf8')
  const notAnImage = join(sandbox.root, 'notes.txt')
  writeFileSync(notAnImage, 'hello', 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 728))
    await openSettings(page)
    const dialog = page.getByRole('dialog', { name: 'Project settings' })
    const source = dialog.locator('#ps-icon-source')
    await expect(source).toHaveText('Found in favicon.svg')
    await expect(dialog.locator('.proj-avatar.large.has-image')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Use detected' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Choose image…' })).toBeVisible()

    for (const row of await dialog.locator('.ps-row').all()) {
      const height = await row.evaluate((node) => (node as HTMLElement).offsetHeight)
      expect(height).toBeGreaterThanOrEqual(56)
      expect(height).toBeLessThanOrEqual(64)
    }
    const wraps = await dialog.locator('.ps-icon-row .btn').evaluateAll((buttons) => buttons.some((button) => (button as HTMLElement).offsetHeight > 32))
    expect(wraps).toBe(false)
    const overflow = await dialog.locator('.ps-body').evaluate((body) => body.scrollWidth > body.clientWidth)
    expect(overflow).toBe(false)

    await app.evaluate(({ dialog: electronDialog }, path) => {
      electronDialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as unknown as typeof electronDialog.showOpenDialog
    }, notAnImage)
    await dialog.getByRole('button', { name: 'Choose image…' }).click()
    await expect(page.getByRole('status').getByText('Use a PNG, SVG, ICO, JPG or WebP image.')).toBeVisible()
    await expect(source).toHaveText('Found in favicon.svg')

    await app.evaluate(({ dialog: electronDialog }, path) => {
      electronDialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as unknown as typeof electronDialog.showOpenDialog
    }, picked)
    await dialog.getByRole('button', { name: 'Choose image…' }).click()
    await expect(source).toHaveText('Your image')
    await expect.poll(() => smoke(sandbox.userData)?.iconPath).toBe(picked)
    await expect(dialog.getByRole('button', { name: 'Use detected' })).toBeVisible()

    await dialog.getByRole('button', { name: 'Use detected' }).click()
    await expect(source).toHaveText('Found in favicon.svg')
    await expect.poll(() => smoke(sandbox.userData)?.iconPath).toBeUndefined()

    await dialog.getByRole('button', { name: 'Use initials' }).click()
    await expect(source).toHaveText('Initials')
    await expect(dialog.locator('.proj-avatar.large .proj-avatar-letters')).toHaveText('SM')
    await expect.poll(() => smoke(sandbox.userData)?.noIcon).toBe(true)
    await expect(dialog.getByRole('button', { name: 'Use initials' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Use detected' })).toBeVisible()

    const swatches = dialog.getByRole('radio')
    await expect(swatches).toHaveCount(PROJECT_COLORS.length)
    await expect(swatches.and(dialog.locator('[aria-checked="true"]'))).toHaveCount(1)
    await swatches.nth(2).click()
    await expect(swatches.nth(2)).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => smoke(sandbox.userData)?.color).toBe(PROJECT_COLORS[2].color)

    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
