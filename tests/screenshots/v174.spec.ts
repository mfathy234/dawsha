import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, feedTerminal } from '../e2e/helpers'
import { DEMO_ROOT, OUT as DOCS, settle } from './harness'
import { RECAPS, SITE, askPermission, launchDemo, termIdOfPane } from './v17Demo'

test.afterAll(() => rmSync(DEMO_ROOT, { recursive: true, force: true }))

type Clip = { x: number; y: number; width: number; height: number }

const boxOf = async (page: Page, selector: string): Promise<Clip> => {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`No box for ${selector}`)
  return { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) }
}

const save = async (page: Page, targets: string[], clip?: Clip): Promise<void> => {
  const png = await page.screenshot(clip ? { clip } : undefined)
  for (const target of targets) writeFileSync(target, png)
}

const docs = (name: string): string => join(DOCS, name)
const site = (name: string): string => join(SITE, name)

async function openFilesWithTheme(page: Page): Promise<void> {
  await page.locator('#files-button').click()
  await expect(page.locator('#files-view')).toBeVisible()
  for (const path of ['src', 'src/context', 'src/components', 'src/legacy']) await page.locator(`.files-row[data-path="${path}"]`).click()
  await page.locator('.files-row[data-path="src/context/theme.tsx"]').dblclick()
  await expect(page.locator('.files-editor:not([hidden]) .cm-content')).toContainText('ThemeProvider')
}

test('generates the Files, Review and Search screenshots from fake projects only', async () => {
  mkdirSync(DOCS, { recursive: true })
  mkdirSync(SITE, { recursive: true })
  const { app, page } = await launchDemo({})
  try {
    await page.locator('.pane-title', { hasText: 'Add dark mode toggle' }).click()
    await openFilesWithTheme(page)
    await page.locator('#files-changes').click()
    await expect(page.locator('#files-changes')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.files-editor:not([hidden]) .cm-blame-mark').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#files-side')).toBeVisible()
    await settle(page, 1200)
    const view = await boxOf(page, '#files-view')
    await save(page, [docs('files.png')])
    await save(page, [site('files-view.png')], view)

    await page.locator('#files-mode-review').click()
    await page.locator('.files-review-row[data-path="src/context/theme.tsx"] .files-review-open').click()
    await expect(page.locator('.files-editor:not([hidden]) .cm-changedLine').first()).toBeVisible()
    await page.locator('.files-editor:not([hidden]) .cm-review-add').nth(6).click()
    await page.locator('.cm-review-input').fill('Keep the system theme until the user picks one, and add a test for it.')
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('.cm-review-text')).toBeVisible()
    await settle(page, 1000)
    await save(page, [docs('files-review.png')])
    await save(page, [site('files-review.png')], await boxOf(page, '#files-view'))

    await page.locator('#files-mode-search').click()
    await page.locator('#files-search-input').fill('theme')
    await expect(page.locator('.files-hit-group').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('#files-search-summary')).toContainText('results')
    await settle(page, 1000)
    await save(page, [docs('files-search.png')])
    await save(page, [site('files-search.png')], await boxOf(page, '#files-view'))
  } finally {
    await closeApp(app)
  }
})

test('generates the sidebar, grid and Agents screenshots', async () => {
  const { app, page } = await launchDemo({})
  try {
    await page.locator('.pane-title', { hasText: 'Add dark mode toggle' }).click()
    await askPermission(page, 1)
    const waiting = page.getByRole('region', { name: 'Waiting on you' })
    await expect(waiting).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.pane').nth(1)).toHaveAttribute('data-state', 'needs')
    await save(page, [docs('projects-sidebar.png'), docs('grid.png')])
    const rail = await boxOf(page, '.sidebar')
    await save(page, [site('sidebar.png')], { ...rail, height: Math.min(rail.height, 620) })

    await page.locator('#background-button').click()
    await expect(page.locator('.bg-view')).toBeVisible()
    await page.locator('.bg-item', { hasText: 'Persist the choice in localStorage' }).click()
    await expect(page.locator('#bg-details')).toBeVisible()
    await expect(page.locator('#bg-detail-title')).toHaveText('Persist the choice in localStorage')
    await settle(page, 1200)
    await save(page, [docs('agents-tab.png'), site('agents-detail.png')])

    await page.locator('#bg-layout-timeline').click()
    await expect(page.locator('#bg-timeline')).toBeVisible()
    await settle(page, 1200)
    await save(page, [site('agents-timeline.png')])
  } finally {
    await closeApp(app)
  }
})

test('generates the Dawsha Cards grid screenshot', async () => {
  const { app, page } = await launchDemo({ theme: { id: 'dawsha-cards' }, dimOtherPanes: true })
  try {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dawsha-cards')
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
    await settle(page, 800)
    await save(page, [site('cards-grid.png')])
  } finally {
    await closeApp(app)
  }
})
