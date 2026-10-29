import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

test('Problems lists what a run reported by file, opens a row at its line, and clears when the run starts again', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  mkdirSync(join(root, 'src'), { recursive: true })
  const body = Array.from({ length: 12 }, (_, index) => `export const line${index + 1} = ${index + 1}`).join('\n')
  writeFileSync(join(root, 'src', 'a.ts'), `${body}\n`)
  writeFileSync(join(root, 'src', 'b.ts'), `${body}\n`)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'problems-fixture', private: true, scripts: { build: 'node check.cjs' } }))
  writeFileSync(join(root, 'check.cjs'), [
    "const fs = require('node:fs')",
    "const first = !fs.existsSync('ran.txt')",
    "fs.writeFileSync('ran.txt', 'x')",
    'if (first) {',
    "  console.log(\"src/a.ts(7,5): error TS2322: Type 'string' is not assignable to type 'number'.\")",
    "  console.log('src/a.ts(9,1): warning TS6133: x is declared but never used.')",
    "  console.log('/elsewhere/lib/c.ts(3,1): error TS2304: Cannot find name y.')",
    "  console.log('src/b.ts:4:2 - error TS2554: Expected 1 arguments, but got 0.')",
    "} else console.log('all clear')",
    ''
  ].join('\n'))
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await page.locator('#files-run-toggle').click()
    await expect(page.locator('#run-source')).toContainText('package.json')
    const commandId = await page.locator('#run-command').evaluate((node) => [...(node as HTMLSelectElement).options].find((option) => /build/i.test(option.textContent ?? ''))?.value)
    await page.locator('#run-command').selectOption(commandId!)
    await page.locator('#run-start').click()
    await expect(page.locator('#files-ptab-problems')).toHaveText('Problems 4', { timeout: 30_000 })
    await page.locator('#files-ptab-problems').click()
    await expect(page.locator('#files-problems-summary')).toHaveText('3 errors, 1 warning')
    await expect(page.locator('.files-problems-path')).toHaveText(['src/a.ts', '/elsewhere/lib/c.ts', 'src/b.ts'])
    const first = page.locator('.files-problem[data-path="src/a.ts"][data-line="7"]')
    await expect(first).toContainText('Error')
    await expect(first).toContainText('a.ts:7')
    await expect(first).toContainText("Type 'string' is not assignable")
    await expect(page.locator('.files-problem[data-severity="warning"]')).toContainText('Warning')
    await expect(page.locator('.files-problem[data-path=""] button.files-problem-open')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/screens/175-files-problems.png' })

    await first.locator('.files-problem-open').click()
    await expect(page.locator('#files-status')).toContainText('Ln 7')
    await expect(page.locator('.files-tab[aria-selected="true"]')).toContainText('a.ts')

    await page.locator('#files-problems-send-all').click()
    await expect(page.locator('.toast').filter({ hasText: 'session' })).toBeVisible()

    await page.locator('.files-panel-tab[data-run]').click()
    await page.locator('#run-restart').click()
    await page.locator('#files-ptab-problems').click()
    await expect(page.locator('#files-problems-empty')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#files-ptab-problems')).toHaveText('Problems')
  } finally {
    await closeApp(app)
  }
})
