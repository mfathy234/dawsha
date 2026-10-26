import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

async function addPanes(page: Page, count: number): Promise<void> {
  const have = await page.locator('.pane').count()
  for (let index = have; index < count; index += 1) {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(index + 1, { timeout: 20_000 })
  }
}

const boxes = async (page: Page) => Promise.all((await page.locator('.grid > .pane').all()).map((pane) => pane.boundingBox()))

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENS, { recursive: true })
  await page.screenshot({ path: join(SCREENS, `162-a-${name}.png`) })
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: join(SHOTS, `162-a-${name}.png`) })
  }
}

for (const [mode, themeId] of THEMES) {
  test(`${mode}: panes keep a calm shape from two to five sessions`, async () => {
    const sandbox = createSandbox()
    const settings = { version: 2, lastSeenVersion: APP_VERSION, dimOtherPanes: true, projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }], ...(themeId ? { theme: { id: themeId } } : {}) }
    writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify(settings), 'utf8')
    const { app, page } = await launchApp(sandbox)
    try {
      await addPanes(page, 2)
      const two = (await boxes(page)).map((b) => b!)
      expect(Math.abs(two[0].width - two[1].width)).toBeLessThan(2)
      await shot(page, `${mode}-2-panes`)

      await addPanes(page, 3)
      const three = (await boxes(page)).map((b) => b!)
      expect(three[0].height).toBeGreaterThan(three[1].height * 1.8)
      expect(three[0].width).toBeGreaterThan(three[1].width)
      expect(Math.abs(three[1].width - three[2].width)).toBeLessThan(2)
      expect(Math.abs(three[0].width / (three[0].width + three[1].width + 12) - 0.57)).toBeLessThan(0.03)

      // Pane 1 is not focused while pane 3 is, so its prompt is left waiting for an answer.
      const first = page.locator('.pane').first()
      const termId = (await first.locator('.term-host').first().getAttribute('data-term-id')) ?? ''
      // ConPTY redraws the screen when a pane is resized, so feed again until both lines are showing.
      await expect(async () => {
        await feedTerminal(page, termId, '\r\n\u203b recap: Import script fixed; waiting on the dev migration before re-importing.\r\n' + PROMPT)
        await expect(first).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
        await expect(first.locator('.pane-recap')).toContainText('Import script fixed', { timeout: 3500 })
      }).toPass({ timeout: 30_000 })
      await expect(first.locator('.pane-permission')).toBeVisible()
      await expect(first.locator('.pane-permission').getByRole('button', { name: /^Allow/ })).toBeVisible()
      await expect(page.locator('#needs-chip')).toContainText('1 needs you')
      await expect(page.locator('.topbar-count')).toContainText('idle')
      await expect(page.locator('.pane.calm')).toHaveCount(2)
      await expect(page.locator('.pane.calm .pane-body').first()).toHaveCSS('filter', mode === 'dark' ? 'brightness(0.72) saturate(0.8)' : 'brightness(0.86) saturate(0.8)')
      await shot(page, `${mode}-3-panes`)

      await addPanes(page, 4)
      expect(Math.abs((await boxes(page))[3]!.width - (await boxes(page))[2]!.width)).toBeLessThan(2)
      await shot(page, `${mode}-4-panes`)

      await addPanes(page, 5)
      const five = (await boxes(page)).map((b) => b!)
      expect(five[0].height).toBeGreaterThan(five[1].height * 1.8)
      expect(Math.abs(five[1].width - five[2].width)).toBeLessThan(2)
      await shot(page, `${mode}-5-panes`)
    } finally {
      await closeApp(app)
    }
  })
}

test('dim others is off until the top bar switch is turned on, and it persists', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await addPanes(page, 2)
    const toggle = page.getByRole('switch', { name: 'Dim others' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('.pane.calm')).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.pane.calm')).toHaveCount(1)
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).dimOtherPanes).toBe(true)
    await closeApp(app)
    const again = await launchApp(sandbox)
    try {
      await addPanes(again.page, 2)
      await expect(again.page.getByRole('switch', { name: 'Dim others' })).toHaveAttribute('aria-checked', 'true')
      await expect(again.page.locator('.pane.calm')).toHaveCount(1)
      await again.page.getByRole('switch', { name: 'Dim others' }).click()
      await expect(again.page.locator('.pane.calm')).toHaveCount(0)
    } finally {
      await closeApp(again.app)
    }
    return
  } finally {
    await closeApp(app).catch(() => undefined)
  }
})

test('the recap setting hides the one-line recap', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await addPanes(page, 1)
    const pane = page.locator('.pane').first()
    const termId = (await pane.locator('.term-host').first().getAttribute('data-term-id')) ?? ''
    await expect(async () => {
      await feedTerminal(page, termId, '\r\n※ recap: Import script fixed; waiting on the dev migration before re-importing.\r\n')
      await expect(pane.locator('.pane-recap')).toContainText('Import script fixed', { timeout: 3500 })
    }).toPass({ timeout: 30_000 })
    await expect(pane.locator('.pane-recap')).toBeVisible()
    await page.locator('#settings-button').click()
    const toggle = page.getByRole('checkbox', { name: 'Show a one-line recap in each session' })
    await expect(toggle).toBeChecked()
    await toggle.uncheck()
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await expect(pane).toBeVisible()
    await expect(pane.locator('.pane-recap')).toBeHidden()
    await page.locator('#settings-button').click()
    await page.getByRole('checkbox', { name: 'Show a one-line recap in each session' }).check()
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await expect(async () => {
      await feedTerminal(page, termId, '\r\n\u203b recap: Import script fixed; waiting on the dev migration before re-importing.\r\n')
      await expect(pane.locator('.pane-recap')).toBeVisible({ timeout: 3500 })
    }).toPass({ timeout: 30_000 })
    await expect(pane.locator('.pane-recap')).toContainText('Import script fixed')
  } finally {
    await closeApp(app)
  }
})
