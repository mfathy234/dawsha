import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const SECRET = 'hunter2-very-secret'

test('the Config tab lists settings, shows which file wins per environment, masks secrets until clicked and names broken files', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  mkdirSync(join(root, 'api'), { recursive: true })
  mkdirSync(join(root, 'broken'), { recursive: true })
  writeFileSync(join(root, 'api', 'appsettings.json'), `// shared settings\n{\n  "Logging": { "Level": "Information" },\n  "ConnectionStrings": { "Default": "Server=db;Password=${SECRET};" },\n  "Port": 80, /* trailing comma next */\n}\n`)
  writeFileSync(join(root, 'api', 'appsettings.Production.json'), '{\n  "Logging": { "Level": "Warning" }\n}\n')
  writeFileSync(join(root, 'api', '.env'), `API_TOKEN=${SECRET}\nMODE=local\n`)
  writeFileSync(join(root, 'broken', 'appsettings.json'), '{\n  "A": 1\n  "B": 2\n}\n')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await page.locator('#files-run-toggle').click()
    await page.locator('#files-ptab-config').click()
    await expect(page.locator('#files-config-summary')).toContainText('settings in 4 files')
    await expect(page.locator('.files-config-broken')).toContainText('Line 3')
    await expect(page.locator('.files-config-broken')).toContainText('broken/appsettings.json')

    const level = page.locator('.files-config-row', { has: page.locator('[data-key="Logging:Level"]') })
    await expect(level).toContainText('Information')
    await expect(level.locator('.files-config-source')).toContainText('appsettings.json:3')
    await page.locator('#files-config-env').selectOption('Production')
    await expect(level).toContainText('Warning')
    await expect(level.locator('.files-config-source')).toContainText('appsettings.Production.json:2')
    await expect(level.locator('.files-config-over')).toContainText('Overrides appsettings.json')

    await expect(page.locator('#files-config')).not.toContainText(SECRET)
    const connection = page.locator('.files-config-row', { has: page.locator('[data-key="ConnectionStrings:Default"]') })
    await expect(connection.locator('.files-config-value')).toHaveClass(/masked/)
    await expect(connection.locator('.files-config-value')).not.toContainText('Password')
    await connection.locator('.files-config-value').click()
    await expect(connection.locator('.files-config-value')).toContainText(`Password=${SECRET}`)
    await connection.locator('.files-config-value').click()
    await expect(page.locator('#files-config')).not.toContainText(SECRET)

    await expect(page.locator('.files-config-row', { has: page.locator('[data-key="API_TOKEN"]') }).locator('.files-config-value')).toHaveClass(/masked/)
    await expect(page.locator('.files-config-row', { has: page.locator('[data-key="MODE"]') }).locator('.files-config-value')).toHaveText('local')

    await page.locator('#files-config-filter').fill('port')
    await expect(page.locator('.files-config-row')).toHaveCount(1)
    await page.screenshot({ path: 'test-results/screens/190-files-config.png' })

    await page.locator('.files-config-open[data-key="Port"]').click()
    await expect(page.locator('#files-editor, .cm-editor').first()).toBeVisible()
    await expect(page.locator('.cm-content')).toContainText('shared settings')
  } finally {
    await closeApp(app)
  }
})
