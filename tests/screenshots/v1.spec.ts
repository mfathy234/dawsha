import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, feedTerminal, launchApp, type Sandbox } from '../e2e/helpers'
import {
  DEMO_ROOT,
  OUT,
  PROJECTS,
  demoEnv,
  folder,
  resize,
  seed,
  settle,
  writeClaudeSession,
  writeCodex,
  writeGemini,
  writeOps
} from './harness'
import { shrinkTo, writeActiveTranscript, writeClosedSessions, writeReplay } from './v1Fixtures'

const PERMISSION = ['  Bash command', '    npm run db:migrate -- --dry-run', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')

const codexRollout = (sandbox: Sandbox): string =>
  join(sandbox.codexHome, 'sessions', '2026', '10', '08', readdirSync(join(sandbox.codexHome, 'sessions', '2026', '10', '08')).find((name) => name.includes('d3a0'))!)

test.afterAll(() => rmSync(DEMO_ROOT, { recursive: true, force: true }))

const termIdOfPane = async (page: Page, index: number): Promise<string> => {
  const id = await page.locator('.pane').nth(index).locator('.term-host').first().getAttribute('data-term-id')
  if (!id) throw new Error('No terminal in the pane')
  return id
}

test('generates the board, timeline, search and replay screenshots from fake projects only', async () => {
  mkdirSync(OUT, { recursive: true })
  const sandbox = createSandbox()
  seed(sandbox, true)
  const settingsPath = join(sandbox.userData, 'settings.json')
  const stored = JSON.parse(readFileSync(settingsPath, 'utf8'))
  writeFileSync(settingsPath, JSON.stringify({ ...stored, recordings: { enabled: false, keepDays: 14, maxMegabytes: 1024 } }), 'utf8')
  writeActiveTranscript(sandbox, folder('acme-web'))
  writeClosedSessions(sandbox, folder)
  writeReplay(sandbox, folder('acme-web'))
  const { app, page } = await launchApp(sandbox, demoEnv())
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await resize(app)
    for (const project of PROJECTS) {
      const agent = project.defaultAgent[0].toUpperCase() + project.defaultAgent.slice(1)
      await page.getByRole('button', { name: `New ${agent} session in ${project.name}`, exact: true }).click()
    }
    await expect(page.locator('.pane')).toHaveCount(4)
    writeClaudeSession(sandbox, 'acme-web', 'Add dark mode toggle', 'busy')
    writeClaudeSession(sandbox, 'billing-api', 'Refactor invoice export', 'busy')
    writeOps(sandbox)
    writeCodex(sandbox)
    await writeGemini(sandbox, page)
    for (const title of ['Add dark mode toggle', 'Refactor invoice export', 'Fix flaky login test', 'Rewrite the getting started guide']) {
      await expect(page.locator('.pane-title', { hasText: title })).toHaveCount(1, { timeout: 20_000 })
    }

    await page.locator('.pane-title', { hasText: 'Add dark mode toggle' }).click()
    await page.locator('#layout-board').click()
    await expect(page.locator('.board-view')).toBeVisible()
    await feedTerminal(page, await termIdOfPane(page, 1), PERMISSION)
    await expect(page.locator('.board-col-working .board-card')).toHaveCount(2, { timeout: 20_000 })
    appendFileSync(codexRollout(sandbox), `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } })}
`)
    await expect(page.locator('.board-col-needs .board-card')).toHaveCount(1, { timeout: 20_000 })
    await expect(page.locator('.board-col-done .board-card', { hasText: 'Fix flaky login test' })).toHaveCount(1, { timeout: 20_000 })
    await page.waitForTimeout(6000)
    const docsDone = page.locator('.board-col-done .board-card', { hasText: 'Rewrite the getting started guide' })
    if ((await docsDone.count()) > 0) await docsDone.getByRole('button', { name: /^Mark .* reviewed$/ }).click()
    await expect(page.locator('.board-col-reviewed .board-card')).toHaveCount(1)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1760, 1100))
    await settle(page, 2000)
    writeFileSync(join(OUT, 'board.png'), await shrinkTo(await page.screenshot(), 1600, 1000))

    await page.locator('.board-col-working .board-card').first().click()
    await expect(page.locator('.board-peek')).toBeVisible()
    await settle(page, 1500)
    writeFileSync(join(OUT, 'board-peek.png'), await shrinkTo(await page.screenshot(), 1600, 1000))
    await page.keyboard.press('Escape')
    await resize(app)
    await page.locator('#layout-grid').click()
    await expect(page.locator('.grid-area')).toBeVisible()

    await page.locator('.pane').first().click()
    await page.keyboard.press('Control+Shift+T')
    const panel = page.getByRole('complementary', { name: 'Timeline' })
    await expect(panel).toBeVisible()
    await expect(panel.locator('.tl-event.tl-prompt')).toHaveCount(2, { timeout: 20_000 })
    await settle(page, 1500)
    await page.screenshot({ path: join(OUT, 'timeline.png') })

    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await page.locator('.pane-title', { hasText: 'Add dark mode toggle' }).click()
    await page.keyboard.press('Control+Alt+F')
    const search = panel.getByRole('searchbox', { name: 'Search all sessions' })
    await expect(search).toBeFocused()
    await search.fill('rate limit')
    await expect(panel.locator('.tl-result')).toHaveCount(2, { timeout: 20_000 })
    await settle(page, 1500)
    await page.screenshot({ path: join(OUT, 'timeline-search.png') })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    await page.keyboard.press('Control+k')
    await page.keyboard.type('Replay a session')
    await page.keyboard.press('Enter')
    await expect(page.locator('.replay-picker')).toBeVisible()
    await page.locator('.replay-picker .palette-row', { hasText: 'Add dark mode toggle' }).first().click()
    await expect(page.locator('.replay-view')).toBeVisible()
    await expect.poll(() => page.locator('.replay-marker').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(4)
    await page.locator('#replay-next').click()
    await page.locator('#replay-next').click()
    await page.locator('#replay-search').fill('ThemeToggle')
    await expect(page.locator('.replay-result').first()).toBeVisible({ timeout: 20_000 })
    await settle(page, 1500)
    await page.screenshot({ path: join(OUT, 'replay.png') })
  } finally {
    await closeApp(app)
  }
})
