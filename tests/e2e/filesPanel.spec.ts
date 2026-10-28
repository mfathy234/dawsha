import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

test('the bottom panel has Run and Problems tabs, can be minimised, and remembers its height and state', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.projectFolder, 'a.txt'), 'x')
  let first = await launchApp(sandbox)
  let height = ''
  try {
    const { page } = first
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await expect(page.locator('#files-run-toggle')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#files-panel-body')).toBeHidden()
    await page.locator('#files-run-toggle').click()
    await expect(page.locator('#files-run-toggle')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('#files-run-panel')).toBeVisible()
    await page.locator('#files-ptab-problems').click()
    await expect(page.locator('#files-problems')).toContainText('No problems')
    await expect(page.locator('#files-run-panel')).toBeHidden()
    await page.locator('#files-ptab-run').click()
    await expect(page.locator('#run-message')).toContainText('No run commands')
    await page.locator('#files-panel-grip').focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    height = (await page.locator('#files-panel-grip').getAttribute('aria-valuenow')) ?? ''
    expect(Number(height)).toBeGreaterThan(220)
    await page.screenshot({ path: 'test-results/screens/174-files-panel.png' })
  } finally {
    await closeApp(first.app)
  }
  first = await launchApp(sandbox)
  try {
    const { page } = first
    await page.locator('#files-button').click()
    await expect(page.locator('#files-run-toggle')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('#files-panel-grip')).toHaveAttribute('aria-valuenow', height)
    await page.locator('#files-run-toggle').click()
    await expect(page.locator('#files-run-toggle')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#files-panel-body')).toBeHidden()
  } finally {
    await closeApp(first.app)
  }
})

test('a run gets its own tab, the status bar shows the command and its port, and Restart starts it again', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'panel-fixture', private: true, scripts: { dev: 'node server.cjs' } }))
  writeFileSync(join(root, 'server.cjs'), "require('node:fs').appendFileSync('starts.txt', 'x\\n'); console.log('  Local:   http://localhost:5173/'); setInterval(() => {}, 1000)\n")
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await page.locator('#files-run-toggle').click()
    await expect(page.locator('#run-source')).toContainText('package.json')
    const commandId = await page.locator('#run-command').evaluate((node) => [...(node as HTMLSelectElement).options].find((option) => /dev/i.test(option.textContent ?? ''))?.value)
    await page.locator('#run-command').selectOption(commandId!)
    await page.locator('#run-start').click()
    await expect(page.locator('#run-output')).toContainText('localhost:5173', { timeout: 30_000 })
    await expect(page.locator('.files-panel-tab[data-run]')).toHaveCount(1)
    await expect(page.locator('.files-panel-tab[data-run]')).toContainText(/^Run · dev/)
    await expect(page.locator('#files-status-run')).toHaveText(/^dev.* running · :5173$/)
    await page.screenshot({ path: 'test-results/screens/174-files-run-tab.png' })

    await page.locator('#run-restart').click()
    await expect.poll(() => (existsSync(join(root, 'starts.txt')) ? readFileSync(join(root, 'starts.txt'), 'utf8').split('\n').filter(Boolean).length : 0), { timeout: 30_000 }).toBe(2)
    await expect(page.locator('#files-status-run')).toHaveText(/^dev.* running · :5173$/)

    await page.locator('#run-stop').click()
    await expect(page.locator('#files-status-run')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
