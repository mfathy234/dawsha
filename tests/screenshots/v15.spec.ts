import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { OrchRunDetail } from '../../src/shared/orch/api'
import { closeApp, createSandbox, launchApp, openMore } from '../e2e/helpers'
import { DEMO_ROOT, folder, resize, seed, settle } from './harness'
import { demoTicketNotes, exportDecision, exportRun, invoiceBugRun, offlineRun, writeWorkHistory } from './v15Fixtures'
import { shrinkTo } from './v1Fixtures'

const SITE_ASSETS = resolve(__dirname, '../../site/assets')
const OUT = process.env.DAWSHA_SHOTS_OUT ?? SITE_ASSETS

test.afterAll(() => rmSync(DEMO_ROOT, { recursive: true, force: true }))

test('generates the orchestrator and work dashboard screenshots from fake projects only', async () => {
  mkdirSync(OUT, { recursive: true })
  const sandbox = createSandbox()
  seed(sandbox, true)
  const settingsPath = join(sandbox.userData, 'settings.json')
  const stored = JSON.parse(readFileSync(settingsPath, 'utf8'))
  writeFileSync(settingsPath, JSON.stringify({ ...stored, onboardingDismissed: true, experimental: { orchestrator: true }, ticketNotes: demoTicketNotes() }), 'utf8')
  writeWorkHistory(sandbox, folder)
  const runs: OrchRunDetail[] = [exportRun(), invoiceBugRun(), offlineRun()]
  const { app, page } = await launchApp(sandbox)
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await resize(app)
    await app.evaluate(({ ipcMain, webContents }, value) => {
      ipcMain.removeHandler('orch:snapshot')
      ipcMain.handle('orch:snapshot', () => ({ status: { enabled: true, running: true, error: null }, runs: value.runs, decisions: [value.decision] }))
      for (const contents of webContents.getAllWebContents()) contents.send('orch:changed')
    }, { runs, decision: exportDecision() })

    await openMore(page, 'orchestrator')
    await page.locator('#orch-tab-runs').click()
    await page.locator('.orch-view').getByRole('button', { name: 'Open', exact: true }).first().click()
    await expect(page.locator('.orch-run')).toContainText('Add CSV export to the usage report')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1920, 1200))
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await settle(page, 1500)
    writeFileSync(join(OUT, 'orch-run.png'), await shrinkTo(await page.screenshot(), 1600, 1000))

    await page.getByRole('button', { name: 'Expand sidebar' }).click()
    await resize(app)
    await page.locator('#orch-tab-boards').click()
    await expect(page.locator('.orch-view')).toContainText('Export button and dialog')
    await settle(page, 1500)
    writeFileSync(join(OUT, 'orch-boards.png'), await page.screenshot())

    await page.locator('#orch-tab-new').click()
    await page.locator('#orch-nr-project').selectOption('acme-web')
    await page.locator('#orch-nr-kind-feature').click()
    await page.locator('#orch-nr-story').fill('Let people export the usage report for a date range as a CSV file, from a button on the report page.')
    await page.locator('#orch-nr-title').fill('Add CSV export to the usage report')
    await settle(page, 1500)
    writeFileSync(join(OUT, 'orch-new-run.png'), await page.screenshot())

    await openMore(page, 'work')
    const view = page.getByRole('main', { name: 'Work dashboard' })
    await expect(view).toBeVisible()
    await view.getByRole('tab', { name: 'This week', exact: true }).click()
    await expect(view).toHaveAttribute('aria-busy', 'false')
    await expect(page.locator('.work-item')).toHaveCount(9, { timeout: 30_000 })
    await settle(page, 1500)
    writeFileSync(join(OUT, 'work.png'), await page.screenshot())

    await page.getByRole('tab', { name: 'Tickets', exact: true }).click()
    await expect(page.locator('.work-ticket-row').first()).toBeVisible()
    await settle(page, 1500)
    writeFileSync(join(OUT, 'work-tickets.png'), await page.screenshot())
  } finally {
    await closeApp(app)
  }
})
