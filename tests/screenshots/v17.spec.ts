import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, feedTerminal } from '../e2e/helpers'
import { DEMO_ROOT, OUT as DOCS, settle } from './harness'
import { RECAPS, SITE, askPermission, launchDemo, termIdOfPane } from './v17Demo'

test.afterAll(() => rmSync(DEMO_ROOT, { recursive: true, force: true }))

test('generates the Files view, quick open and tag colour screenshots from fake projects only', async () => {
  mkdirSync(DOCS, { recursive: true })
  mkdirSync(SITE, { recursive: true })
  const { app, page } = await launchDemo({})
  const both = async (docs: string, site: string): Promise<void> => {
    const png = await page.screenshot()
    writeFileSync(join(DOCS, docs), png)
    writeFileSync(join(SITE, site), png)
  }
  try {
    await expect(page.locator('.pane-tag .tag-word').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('.pane-title', { hasText: 'Add dark mode toggle' }).click()
    await page.locator('.pane').first().locator('.term-host').first().click()
    await page.keyboard.press('Control+p')
    await expect(page.locator('#quick-open-input')).toBeFocused()
    await page.keyboard.type('theme')
    await expect(page.locator('.qo-row').first()).toBeVisible()
    await expect(page.locator('#quick-open-preview')).not.toHaveText('')
    await page.addStyleTag({ content: '.qo-preview { overflow-x: hidden; }' })
    await settle(page, 1200)
    await both('quick-open.png', 'quick-open.png')
    await page.keyboard.press('Escape')
    await expect(page.locator('#quick-open-input')).toHaveCount(0)

    await page.locator('#files-button').click()
    await expect(page.locator('#files-view')).toBeVisible()
    await page.locator('.files-row[data-path="src"]').click()
    await page.locator('.files-row[data-path="src/context"]').click()
    await page.locator('.files-row[data-path="src/components"]').click()
    await page.locator('.files-row[data-path="src/legacy"]').click()
    await page.locator('.files-row[data-path="src/context/theme.tsx"]').dblclick()
    await expect(page.locator('.files-editor:not([hidden]) .cm-content')).toContainText('ThemeProvider')
    await expect(page.locator('#files-outline .files-side-row').first()).toBeVisible()
    await page.getByRole('tab', { name: 'Activity', exact: true }).click()
    await expect(page.locator('#files-activity .files-side-row.activity').first()).toBeVisible({ timeout: 20_000 })
    await settle(page, 1200)
    await both('files.png', 'files-view.png')
    await page.locator('#files-button').click()
    await expect(page.locator('#files-view')).toBeHidden()

    await page.locator('#layout-board').click()
    await expect(page.locator('.board-view')).toBeVisible()
    await askPermission(page, 1)
    await expect(page.locator('.board-col-needs .board-card')).toHaveCount(1, { timeout: 20_000 })
    await expect(page.locator('.board-card .tag-word').first()).toBeVisible()
    await settle(page, 1500)
    writeFileSync(join(SITE, 'tag-colours.png'), await page.screenshot())

    await page.locator('#layout-grid').click()
    await page.locator('#background-button').click()
    await expect(page.locator('.crew-view')).toBeVisible()
    await settle(page, 1500)
    writeFileSync(join(DOCS, 'agents-tab.png'), await page.screenshot())
  } finally {
    await closeApp(app)
  }
})

test('generates the calm grid screenshot', async () => {
  const { app, page } = await launchDemo({ dimOtherPanes: true })
  try {
    for (let index = 0; index < 4; index += 1) {
      const id = await termIdOfPane(page, index)
      const pane = page.locator('.pane').nth(index)
      await expect(async () => {
        await feedTerminal(page, id, `\r\n※ recap: ${RECAPS[index]}\r\n`)
        await expect(pane.locator('.pane-recap')).toBeVisible({ timeout: 3500 })
      }).toPass({ timeout: 30_000 })
    }
    await page.locator('.pane-title', { hasText: 'Add dark mode toggle' }).click()
    await settle(page, 2000)
    await askPermission(page, 1)
    await expect(page.locator('#needs-chip')).toContainText('1 needs you')
    await page.waitForTimeout(300)
    await expect(page.locator('.pane').nth(1)).toHaveAttribute('data-state', 'needs')
    writeFileSync(join(SITE, 'calm-grid.png'), await page.screenshot())
  } finally {
    await closeApp(app)
  }
})
