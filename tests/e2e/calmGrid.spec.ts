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
  test(`${mode}: with the move switch on, calm focus keeps the focused session large and the rest in a quiet column`, async () => {
    const sandbox = createSandbox()
    const settings = { version: 2, lastSeenVersion: APP_VERSION, dimOtherPanes: true, focusMovesSelected: true, projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }], ...(themeId ? { theme: { id: themeId } } : {}) }
    writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify(settings), 'utf8')
    const { app, page } = await launchApp(sandbox)
    try {
      await addPanes(page, 2)
      const two = (await boxes(page)).map((b) => b!)
      const twoFocus = await page.locator('.grid > .pane.focused').boundingBox()
      expect(twoFocus!.width).toBeGreaterThan(two.find((b) => b !== twoFocus)!.width * 1.2)
      await shot(page, `${mode}-2-panes`)

      await addPanes(page, 3)
      const three = (await boxes(page)).map((b) => b!)
      const focusedThree = (await page.locator('.grid > .pane.focused').boundingBox())!
      const siblingsThree = three.filter((b) => b.width < focusedThree.width - 2)
      expect(focusedThree.height).toBeGreaterThan(siblingsThree[0].height * 1.8)
      expect(focusedThree.width).toBeGreaterThan(siblingsThree[0].width * 1.2)
      expect(Math.abs(siblingsThree[0].width - siblingsThree[1].width)).toBeLessThan(2)

      // Pane 1 is not focused while pane 3 is, so its prompt is left waiting for an answer.
      const first = page.locator('.pane').first()
      const termId = (await first.locator('.term-host').first().getAttribute('data-term-id')) ?? ''
      // ConPTY redraws the screen when a pane is resized, so feed again until both lines are showing.
      // Promoting the needs-you sibling resizes its terminal, and the shell redraws over the fed prompt a moment later,
      // so the checks for the waiting state run in the same retry as the feed.
      await expect(async () => {
        await feedTerminal(page, termId, '\r\n※ recap: Import script fixed; waiting on the dev migration before re-importing.\r\n' + PROMPT)
        await expect(first).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
        await expect(first.locator('.pane-recap')).toContainText('Import script fixed', { timeout: 3500 })
        await expect(first.locator('.pane-permission')).toBeVisible({ timeout: 1500 })
        await expect(first.locator('.pane-permission').getByRole('button', { name: /^Allow/ })).toBeVisible()
        await expect(page.locator('#needs-chip')).toContainText('1 needs you')
        await page.locator('#view-button').click()
        await expect(page.locator('#view-menu-counts')).toContainText('idle')
        await page.keyboard.press('Escape')
        // The needs-you sibling promotes itself to a taller card in the column.
        const promoted = (await boxes(page))[0]!
        const other = (await boxes(page))[1]!
        expect(promoted.height).toBeGreaterThan(other.height * 1.8)
      }).toPass({ timeout: 30_000 })
      await expect(page.locator('.pane.calm')).toHaveCount(2)
      await expect(page.locator('.pane.calm .pane-body').first()).toHaveCSS('filter', mode === 'dark' ? 'brightness(0.86) saturate(0.8)' : 'none')
      await shot(page, `${mode}-3-panes`)

      await addPanes(page, 4)
      const four = (await boxes(page)).map((b) => b!)
      const fourSiblings = four.filter((b) => b.width < Math.max(...four.map((x) => x.width)) - 2)
      expect(fourSiblings.length).toBe(3)
      expect(Math.abs(fourSiblings[0].width - fourSiblings[2].width)).toBeLessThan(2)
      await shot(page, `${mode}-4-panes`)

      await addPanes(page, 5)
      const five = (await boxes(page)).map((b) => b!)
      expect(Math.abs(five[0].width - five[1].width)).toBeLessThan(2)
      expect(Math.abs(five[1].width - five[2].width)).toBeLessThan(2)
      await shot(page, `${mode}-5-panes`)
    } finally {
      await closeApp(app)
    }
  })
}

test('dim others is off until it is turned on in the View menu, and it persists', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await addPanes(page, 2)
    await page.locator('#view-button').click()
    await expect(page.locator('#dim-others')).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('.pane.calm')).toHaveCount(0)
    await page.locator('#dim-others').click()
    await expect(page.locator('.pane.calm')).toHaveCount(1)
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).dimOtherPanes).toBe(true)
    await closeApp(app)
    const again = await launchApp(sandbox)
    try {
      await addPanes(again.page, 2)
      await expect(again.page.locator('.pane.calm')).toHaveCount(1)
      await again.page.locator('#view-button').click()
      await expect(again.page.locator('#dim-others')).toHaveAttribute('aria-checked', 'true')
      await again.page.locator('#dim-others').click()
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
    const toggle = page.getByRole('switch', { name: 'Show a one-line recap in each session' })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await expect(pane).toBeVisible()
    await expect(pane.locator('.pane-recap')).toBeHidden()
    await page.locator('#settings-button').click()
    await page.getByRole('switch', { name: 'Show a one-line recap in each session' }).click()
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
