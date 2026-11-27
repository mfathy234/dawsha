import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, feedTerminal, launchApp, bufferText, type Sandbox } from '../e2e/helpers'

// Dawsha 1.10.3 rail, sidebar and Project settings shots. Output folder: DAWSHA_SHOTS_OUT.
const OUT = process.env.DAWSHA_SHOTS_OUT ?? join(__dirname, '../../test-results/shots-1103')
const SIZES = [{ name: '1440x900', width: 1440, height: 900 }, { name: '1024x728', width: 1024, height: 728 }] as const
const THEMES = [['dark', undefined], ['light', 'dawsha-daylight']] as const
const DESKTOP = { panes: 'quiet', frame: 'sidebar', tone: 'warm' }
const PROMPT = ['  npm test -- invoices', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26"><rect x="2" y="5" width="22" height="16" rx="5" fill="#34d399"/><path d="M7 11l3 2-3 2M12 16h5" stroke="#04261b" stroke-width="2" fill="none" stroke-linecap="round"/></svg>'
const NAMES = ['Platforms', 'Dawsha', 'AppsPortal', 'InfrastructureServices', 'GameIdea', 'Nadfny', 'Keycloak Providers', 'WorkflowDesigner', 'MFE-Apps']

function seed(sandbox: Sandbox, themeId: string | undefined): void {
  const projects = NAMES.map((name, index) => {
    const folder = join(sandbox.root, `project-${index}`)
    mkdirSync(folder, { recursive: true })
    if (name === 'Dawsha') writeFileSync(join(folder, 'favicon.svg'), SVG, 'utf8')
    return { id: `p${index}`, name, folder }
  })
  const settings = { version: 2, lastSeenVersion: APP_VERSION, tourSeen: true, projects, appearance: DESKTOP, ...(themeId ? { theme: { id: themeId } } : {}) }
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify(settings), 'utf8')
}

async function resize(app: Parameters<typeof closeApp>[0], width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height])
}

async function newSession(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: new RegExp(`^New (Claude|Codex|Gemini) session in ${name}$`) }).click()
  const id = (await page.locator('.pane.focused .term-host.active').first().getAttribute('data-term-id'))!
  await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
  return id
}

async function needs(page: Page, id: string): Promise<void> {
  await expect(async () => {
    await feedTerminal(page, id, PROMPT)
    await expect.poll(() => bufferText(page, id), { timeout: 1500 }).toContain('1. Yes')
  }).toPass({ timeout: 20_000 })
}

async function shot(page: Page, name: string): Promise<void> {
  await page.mouse.move(2, 2)
  await page.waitForTimeout(700)
  mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: join(OUT, `${name}.png`) })
}

for (const [mode, themeId] of THEMES) {
  test(`${mode}: collapsed rail, expanded sidebar and Project settings`, async () => {
    test.setTimeout(240_000)
    const sandbox = createSandbox()
    seed(sandbox, themeId)
    const { app, page } = await launchApp(sandbox)
    try {
      await resize(app, 1440, 900)
      const first = await newSession(page, 'Platforms')
      await needs(page, first)
      const second = await newSession(page, 'Platforms')
      await needs(page, second)
      await newSession(page, 'AppsPortal')
      await newSession(page, 'InfrastructureServices')
      await newSession(page, 'Dawsha')
      const now = Date.now()
      writeFileSync(join(sandbox.sessionsDir, 'working.json'), JSON.stringify({ pid: process.pid, sessionId: 'working', cwd: join(sandbox.root, 'project-3'), name: 'Rotate the service keys', nameSource: 'user', status: 'busy', startedAt: now + 1000, updatedAt: now + 1000 }), 'utf8')
      await expect(page.locator('.rail-tile, .proj-state.tone-working').first()).toBeAttached()
      for (const size of SIZES) {
        await resize(app, size.width, size.height)
        await expect(page.locator('#sidebar-collapse')).toBeVisible()
        await shot(page, `${mode}-${size.name}-expanded`)
      }
      await page.locator('#sidebar-collapse').click()
      const rail = page.locator('.sidebar.rail')
      await expect(rail).toBeVisible()
      await page.evaluate(() => document.querySelector('.rail-tile[data-drop-project="p2"]')?.classList.add('has-unread'))
      for (const size of SIZES) {
        await resize(app, size.width, size.height)
        await shot(page, `${mode}-${size.name}-rail`)
        await rail.screenshot({ path: join(OUT, `${mode}-${size.name}-rail-only.png`) })
      }
      await page.locator('.rail-tile[data-drop-project="p3"]').hover()
      await rail.screenshot({ path: join(OUT, `${mode}-rail-hover-tile.png`) })
      await page.locator('#sidebar-expand').click()
      await page.getByRole('button', { name: 'Manage projects' }).click()
      await page.getByRole('button', { name: 'More for Dawsha' }).click()
      await page.getByRole('menuitem', { name: 'Project settings…' }).click()
      const dialog = page.getByRole('dialog', { name: 'Project settings' })
      await expect(dialog).toBeVisible()
      await page.waitForTimeout(500)
      for (const size of SIZES) {
        await resize(app, size.width, size.height)
        await shot(page, `${mode}-${size.name}-project-settings`)
        await dialog.screenshot({ path: join(OUT, `${mode}-${size.name}-project-settings-dialog.png`) })
      }
    } finally {
      await closeApp(app)
    }
  })
}
