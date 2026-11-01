import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, feedTerminal, launchApp } from './helpers'

const SCREENS = 'test-results/screens'
const SHOTS = process.env.DAWSHA_SHOTS ?? ''
const PROMPT = ['  npm run migrate -- --env dev', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')
const THEMES = [
  ['dark', undefined],
  ['light', 'dawsha-daylight']
] as const

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENS, { recursive: true })
  await page.screenshot({ path: join(SCREENS, `162-a-${name}.png`) })
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: join(SHOTS, `162-a-${name}.png`) })
  }
}

const withTheme = (sandbox: ReturnType<typeof createSandbox>, themeId: string | undefined, empty: boolean): void => {
  const projects = empty ? [] : [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }]
  const settings = { version: 2, lastSeenVersion: APP_VERSION, projects, ...(themeId ? { theme: { id: themeId } } : {}) }
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify(settings), 'utf8')
}

for (const [mode, themeId] of THEMES) {
  test(`${mode}: every main view and popup`, async () => {
    const sandbox = createSandbox()
    withTheme(sandbox, themeId, false)
    const { app, page } = await launchApp(sandbox)
    try {
      await shot(page, `${mode}-empty-grid`)
      await page.getByRole('button', { name: 'Filter projects and sessions' }).click()
      await page.locator('#sidebar-project-filter').fill('zzz')
      await expect(page.getByText('No project or session matches.')).toBeVisible()
      await shot(page, `${mode}-empty-sidebar-filter`)
      await page.getByRole('button', { name: 'Clear filter' }).click()
      await expect(page.locator('#sidebar-project-filter')).toHaveValue('')

      for (let index = 0; index < 3; index += 1) {
        await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
        await expect(page.locator('.pane')).toHaveCount(index + 1, { timeout: 20_000 })
      }
      await page.getByRole('button', { name: 'Pane actions' }).first().click()
      await page.getByRole('menuitem', { name: 'Tag…' }).click()
      await page.getByRole('menuitemradio', { name: 'Tag as Bug' }).click()
      await page.locator('.pane').nth(2).locator('.pane-body').click({ position: { x: 40, y: 40 } })
      const first = page.locator('.pane').first()
      const termId = (await first.locator('.term-host').first().getAttribute('data-term-id')) ?? ''
      await expect(async () => {
        await feedTerminal(page, termId, '\r\n\u203b recap: Import script fixed; waiting on the dev migration.\r\n' + PROMPT)
        await expect(first).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
        await expect(first.locator('.pane-recap')).toContainText('Import script fixed', { timeout: 3500 })
      }).toPass({ timeout: 30_000 })
      await expect(first.locator('.pane-tag .tag-word')).toHaveText('bug')
      await page.mouse.move(700, 500)
      await shot(page, `${mode}-grid-tagged-approval`)

      await page.locator('#notifications-button').click()
      await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible()
      await page.waitForTimeout(250)
      await shot(page, `${mode}-popover-notifications`)
      await page.keyboard.press('Escape')

      await page.locator('#layout-board').click()
      await expect(page.locator('.board-view')).toBeVisible()
      await shot(page, `${mode}-board`)
      await page.locator('#layout-grid').click()

      await page.locator('#settings-button').click()
      await expect(page.locator('.settings-view')).toBeVisible()
      await shot(page, `${mode}-settings`)
      await page.locator('#getting-started').click()
      await expect(page.locator('.overlay .dialog')).toBeVisible()
      await page.waitForTimeout(250)
      await shot(page, `${mode}-dialog`)
      await page.keyboard.press('Escape')
    } finally {
      await closeApp(app)
    }
  })

  test(`${mode}: empty states without projects`, async () => {
    const sandbox = createSandbox()
    withTheme(sandbox, themeId, true)
    const { app, page } = await launchApp(sandbox)
    try {
      await expect(page.getByRole('heading', { name: 'Add a project to get started' })).toBeVisible()
      await expect(page.locator('.sidebar-empty').getByRole('button', { name: 'Add a project' })).toBeVisible()
      await shot(page, `${mode}-empty-no-projects`)
      await page.keyboard.press('Escape')
      await expect(page.locator('.onboarding-overlay')).toHaveCount(0)
      await page.locator('#layout-board').click()
      await shot(page, `${mode}-empty-board`)
    } finally {
      await closeApp(app)
    }
  })
}
