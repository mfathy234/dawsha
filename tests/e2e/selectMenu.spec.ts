import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { OrchRunDetail } from '../../src/shared/orch/api'
import { APP_VERSION, closeApp, createSandbox, launchApp } from './helpers'

test('Orchestrator dropdown picks a project and keeps the native select in sync', async () => {
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true,
    experimental: { orchestrator: true }, projects: [
      { id: 'alpha', name: 'Alpha', folder: sandbox.projectFolder },
      { id: 'beta', name: 'Beta', folder: sandbox.projectFolder }
    ]
  }))
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#orchestrator-button').click()
    await page.locator('#orch-tab-new').click()
    const trigger = page.getByRole('button', { name: 'Project', exact: true })
    const native = page.locator('#orch-nr-project')
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await page.getByRole('option', { name: 'Beta', exact: true }).click()
    await expect(native).toHaveValue('beta')
    await expect(trigger).toContainText('Beta')
    await expect(trigger).toBeFocused()
    await native.selectOption('alpha')
    await expect(trigger).toContainText('Alpha')
    await trigger.press('ArrowDown')
    await page.keyboard.press('End')
    await page.keyboard.press(' ')
    await expect(native).toHaveValue('beta')
    await trigger.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Enter')
    await expect(native).toHaveValue('alpha')
    await trigger.click()
    await page.keyboard.press('b')
    await page.keyboard.press('Escape')
    await expect(native).toHaveValue('alpha')
    await expect(trigger).toBeFocused()
    await trigger.click()
    await page.locator('#orch-nr-title').click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()
    await page.locator('#orch-tab-history').click()
    await expect(page.locator('.select-menu-popover')).toHaveCount(0)
  } finally { await closeApp(app) }
})

test('live run updates keep an unchanged board filter open and focused', async () => {
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true,
    experimental: { orchestrator: true }
  }))
  const { app, page } = await launchApp(sandbox)
  const publish = async (stage: OrchRunDetail['stage']): Promise<void> => {
    const run: OrchRunDetail = {
      id: 'live-run', kind: 'feature', stage, title: 'Live progress', projectId: null,
      createdAt: 1, taskCount: 0, tasksDone: 0, openDecisions: 0,
      story: '', plan: 'Default', projectPath: '', finishedAt: null, branch: '',
      tasks: [], agents: [], events: [],
      usage: { agents: [], byRole: [], total: { inputTokens: 0, outputTokens: 0,
        cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: 0, complete: true } }
    }
    await app.evaluate(({ ipcMain, webContents }, value) => {
      ipcMain.removeHandler('orch:snapshot')
      ipcMain.handle('orch:snapshot', () => ({ status: { enabled: true, running: true, error: null }, runs: [value], decisions: [] }))
      for (const contents of webContents.getAllWebContents()) contents.send('orch:changed')
    }, run)
  }
  try {
    await publish('build')
    await page.locator('#orchestrator-button').click()
    await page.locator('#orch-tab-boards').click()
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toContainText('All')
    const tab = await page.locator('.orch-projtab').first().elementHandle()
    const trigger = page.getByRole('button', { name: 'Status', exact: true })
    await trigger.click()
    const open = page.getByRole('option', { name: 'Open', exact: true })
    await expect(open).toBeFocused()
    await publish('merge')
    await expect.poll(() => tab!.evaluate((el) => el.isConnected)).toBe(false)
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(open).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect(page.locator('.orch-filter').filter({ hasText: /^Status/ }).locator('select')).toHaveValue('done')
  } finally { await closeApp(app) }
})
