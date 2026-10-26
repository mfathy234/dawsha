import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, feedTerminal, launchApp } from '../e2e/helpers'
import { DEMO_ROOT, OUT as DOCS, PROJECTS, demoEnv, folder, resize, seed, settle, writeClaudeSession, writeCodex, writeGemini, writeOps } from './harness'
import { writeActiveTranscript } from './v1Fixtures'
import { makeAcmeWeb, makeRepo, writeSubagents } from './v17Fixtures'

const SITE = process.env.DAWSHA_SHOTS_OUT ?? resolve(__dirname, '../../site/assets')
const PERMISSION = ['  npm run migrate -- --env dev', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')
const RECAPS = [
  'Toggle is wired into Settings; needs the migration approved.',
  'Export split into three steps; all 41 tests pass.',
  'Login test now waits for ready; 2 profile tests remain.',
  'Guide rewritten for the new installer; screenshots to add.'
]

test.afterAll(() => rmSync(DEMO_ROOT, { recursive: true, force: true }))

const termIdOfPane = async (page: Page, index: number): Promise<string> => {
  const id = await page.locator('.pane').nth(index).locator('.term-host').first().getAttribute('data-term-id')
  if (!id) throw new Error('No terminal in the pane')
  return id
}

async function askPermission(page: Page, index: number): Promise<void> {
  const id = await termIdOfPane(page, index)
  const pane = page.locator('.pane').nth(index)
  await expect(async () => {
    await feedTerminal(page, id, `\r\n${PERMISSION}`)
    await expect(pane).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
  }).toPass({ timeout: 30_000 })
}

function seedRepos(): void {
  for (const project of PROJECTS) rmSync(folder(project.name), { recursive: true, force: true })
  makeAcmeWeb(folder('acme-web'))
  makeRepo(folder('billing-api'), 'billing-api', 'fix/invoice-rounding', { 'src/export/invoices.ts': 'export function exportInvoices() {}\n' })
  makeRepo(folder('mobile-shell'), 'mobile-shell', 'review/login-tests', { 'tests/login.spec.ts': "import { test } from 'vitest'\n" })
  makeRepo(folder('docs-site'), 'docs-site', 'docs/getting-started', { 'docs/getting-started.md': '# Getting started\n' })
}

async function launchDemo(settingsPatch: Record<string, unknown>) {
  const sandbox = createSandbox()
  seed(sandbox, true)
  seedRepos()
  const settingsPath = join(sandbox.userData, 'settings.json')
  const stored = JSON.parse(readFileSync(settingsPath, 'utf8'))
  writeFileSync(settingsPath, JSON.stringify({ ...stored, onboardingDismissed: true, recordings: { enabled: false, keepDays: 14, maxMegabytes: 1024 }, ...settingsPatch }), 'utf8')
  writeActiveTranscript(sandbox, folder('acme-web'))
  writeSubagents(sandbox, folder)
  const launched = await launchApp(sandbox, demoEnv())
  await resize(launched.app)
  const { page } = launched
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const project of PROJECTS) {
    const agent = project.defaultAgent[0].toUpperCase() + project.defaultAgent.slice(1)
    await page.getByRole('button', { name: `New ${agent} session in ${project.name}`, exact: true }).click()
  }
  await expect(page.locator('.pane')).toHaveCount(4)
  writeClaudeSession(sandbox, 'acme-web', 'Add dark mode toggle', 'busy')
  writeClaudeSession(sandbox, 'billing-api', 'Refactor invoice export', 'idle')
  writeOps(sandbox)
  writeCodex(sandbox)
  await writeGemini(sandbox, page)
  for (const title of ['Add dark mode toggle', 'Refactor invoice export', 'Fix flaky login test', 'Rewrite the getting started guide']) {
    await expect(page.locator('.pane-title', { hasText: title })).toHaveCount(1, { timeout: 20_000 })
  }
  return launched
}

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
    await expect(page.locator('.sidebar .tag-word').first()).toBeVisible({ timeout: 30_000 })

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
    await expect(page.locator('#files-sessions .files-side-row').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('#files-outline .files-side-row').first()).toBeVisible()
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
    await expect(page.locator('.agents-view, .bg-view, [aria-label="Agents"]').first()).toBeVisible()
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
