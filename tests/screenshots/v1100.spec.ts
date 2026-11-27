import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, launchApp, type Sandbox } from '../e2e/helpers'

// Dawsha 1.10.0 site shots: Reading view with its outline, the Inbox, and a session with its shell drawer open.
// Generic sample data only. Each shot is a 1168x668 crop of the 1440x900 window.
const SITE = process.env.DAWSHA_SHOTS_OUT ?? resolve(__dirname, '../../site/assets')
const WINDOW = { width: 1440, height: 900 }
const CROP = { x: 0, y: 0, width: 1168, height: 668 }
const PROJECT = 'invoice-api'
const PROMPT = ['  npm test -- invoices', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')
const DEMO_TMP = 'C:\\demo'

/** A sandbox under a short generic folder, with the sample project renamed and the missing one dropped, so no user path shows. */
function demoSandbox(): Sandbox {
  process.env.TMP = DEMO_TMP
  process.env.TEMP = DEMO_TMP
  mkdirSync(DEMO_TMP, { recursive: true })
  const sandbox = createSandbox()
  const file = join(sandbox.userData, 'settings.json')
  const stored = JSON.parse(readFileSync(file, 'utf8'))
  const folder = join(sandbox.root, PROJECT)
  mkdirSync(folder, { recursive: true })
  const projects = stored.projects.filter((project: any) => project.id !== 'gone').map((project: any) => ({ ...project, name: PROJECT, folder }))
  writeFileSync(file, JSON.stringify({ ...stored, projects }), 'utf8')
  return sandbox
}

const SESSION = [
  '> run the invoice tests',
  '',
  '● Bash(npm test)',
  '  ⎿  Test Files  1 failed | 4 passed',
  '     ✗ tests/unit/totals.test.ts > rounds once at the end',
  '     Duration 8.2s',
  '',
  '● Update(src/invoice/totals.ts)',
  '  ⎿  Updated src/invoice/totals.ts with 2 additions and 1 removal',
  '',
  '● All done.',
  ''
].join('\r\n')

async function save(page: Page, name: string, top = 0): Promise<void> {
  await page.mouse.move(WINDOW.width - 2, WINDOW.height - 2)
  await page.waitForTimeout(800)
  mkdirSync(SITE, { recursive: true })
  writeFileSync(resolve(SITE, name), await page.screenshot({ clip: { ...CROP, y: top } }))
}

async function startSession(page: Page): Promise<string> {
  await page.setViewportSize(WINDOW)
  await page.getByRole('button', { name: `New Claude session in ${PROJECT}`, exact: true }).click()
  const id = (await page.locator('.term-host.active').getAttribute('data-term-id'))!
  await expect.poll(() => bufferText(page, id), { timeout: 30_000 }).toMatch(/>\s*$/m)
  return id
}

test('Reading view with the outline open', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp(demoSandbox())
  try {
    const id = await startSession(page)
    const reading = page.locator('.term-host.active .term-reading')
    await expect.poll(async () => {
      if (await reading.isHidden()) {
        await feedTerminal(page, id, `\r\n${SESSION}`)
        await page.locator('.term-host.active').click()
        await page.keyboard.press('Control+Alt+R')
      }
      return reading.locator('.rd-row').count()
    }, { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
    await save(page, 'reading-view.png')
  } finally {
    await closeApp(app)
  }
})

test('Inbox with sessions waiting', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp(demoSandbox())
  try {
    const first = await startSession(page)
    await page.keyboard.press('Control+n')
    await expect(page.locator('.quickpick')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })
    await expect(async () => {
      await feedTerminal(page, first, '\r\n' + PROMPT)
      await expect(page.locator('.pane[data-state="needs"]')).toHaveCount(1, { timeout: 1500 })
    }).toPass({ timeout: 30_000 })
    await page.keyboard.press('Control+i')
    await expect(page.locator('.inbox-view')).toBeVisible()
    await save(page, 'inbox.png')
  } finally {
    await closeApp(app)
  }
})

test('Shell drawer under a session', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp(demoSandbox())
  try {
    const agent = await startSession(page)
    await feedTerminal(page, agent, `\r\n${SESSION}`)
    await page.keyboard.press('Control+Backquote')
    const drawer = page.locator('.shell-drawer')
    await expect(drawer).toBeVisible()
    const shellId = (await drawer.locator('.term-host').getAttribute('data-term-id'))!
    await drawer.locator('.term-host').click()
    await page.keyboard.type('echo 12 tests passed')
    await page.keyboard.press('Enter')
    await expect.poll(() => bufferText(page, shellId)).toContain('12 tests passed')
    await save(page, 'shell-drawer.png', 180)
  } finally {
    await closeApp(app)
  }
})
