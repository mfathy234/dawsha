import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp } from './helpers'

const SCREENS = 'test-results/screens'
const NAMES = [
  'Invoice export refactor with separate query and format steps',
  'Customer portal login flow and password reset emails',
  'Warehouse stock movements report for the finance team',
  'Payroll monthly close and tax declarations for all branches',
  'Mobile app push notifications and deep links to orders',
  'Supplier onboarding wizard with document uploads and checks'
]

test('focus view strip keeps long session names on one line and closes a session from its X', async () => {
  const sandbox = createSandbox()
  const projects = NAMES.map((name, index) => {
    const folder = join(sandbox.root, `project-${index}`)
    mkdirSync(folder, { recursive: true })
    return { id: `p${index}`, name, folder }
  })
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({ version: 2, lastSeenVersion: APP_VERSION, projects }), 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    for (const name of NAMES) {
      await page.getByRole('button', { name: new RegExp(`^New (Claude|Codex|Gemini) session in ${name}$`) }).click()
    }
    await expect(page.locator('.pane')).toHaveCount(NAMES.length)
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('.pane.maximized')).toHaveCount(1)

    const strip = page.locator('.pane-strip')
    const tabs = strip.locator('.strip-tab')
    await expect(tabs).toHaveCount(NAMES.length)
    const stripBox = (await strip.boundingBox())!
    expect(stripBox.height).toBeLessThanOrEqual(24)
    for (const tab of await tabs.all()) {
      const box = (await tab.boundingBox())!
      expect(box.height).toBeLessThanOrEqual(stripBox.height)
      await expect(tab.getByRole('tab')).toHaveAttribute('title', /·/)
    }
    const nameCut = await strip.locator('.strip-name').first().evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(nameCut).toBe(true)
    await page.screenshot({ path: join(SCREENS, 'focus-strip-long-names.png') })

    const last = NAMES[NAMES.length - 1].toUpperCase()
    await strip.getByRole('tab', { name: new RegExp(last.slice(0, 20)) }).click()
    await expect(strip.locator('.strip-tab.selected .strip-name')).toHaveText(last)

    const first = NAMES[0].toUpperCase()
    await strip.getByRole('button', { name: `Close ${first}` }).click()
    await expect(page.locator('.pane')).toHaveCount(NAMES.length - 1)
    await expect(tabs).toHaveCount(NAMES.length - 1)
    await expect(strip.getByRole('button', { name: `Close ${first}` })).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
