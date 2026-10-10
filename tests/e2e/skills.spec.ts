import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

test('Skills lists installed agent and project skills and copies a selected path', async () => {
  const sandbox = createSandbox()
  const claudeSkill = join(sandbox.claudeHome, 'skills', 'Review')
  const codexSkill = join(sandbox.projectFolder, '.codex', 'skills', 'Build')
  const claudeAgent = join(sandbox.claudeHome, 'agents', 'reviewer.md')
  const codexAgent = join(sandbox.codexHome, 'agents', 'architect.toml')
  for (const path of [claudeSkill, codexSkill]) {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'SKILL.md'), `# ${path}`)
  }
  for (const path of [claudeAgent, codexAgent]) {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '# agent')
  }
  const { app, page } = await launchApp(sandbox, { DAWSHA_SHARED_HOME: join(sandbox.root, 'shared-home') })
  try {
    await page.getByRole('button', { name: 'Skills', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Skills', level: 1 })).toBeVisible()
    await expect(page.locator('.skill-row')).toHaveCount(2)
    await expect(page.locator('.skill-row[data-agent="claude"]')).toContainText('Review')
    await expect(page.locator('.skill-row[data-agent="codex"]')).toContainText('Build')
    await page.getByRole('button', { name: 'Codex skills' }).click()
    await expect(page.locator('.skill-row')).toHaveCount(1)
    await page.locator('.skill-row').getByRole('button', { name: 'Copy path' }).click()
    const copied = await page.evaluate(() => window.gridApi.readClipboard())
    expect(copied).toEqual({ kind: 'text', text: codexSkill })
    await page.getByRole('button', { name: 'Installed agents' }).click()
    await expect(page.locator('.skill-row')).toHaveCount(1)
    await expect(page.locator('.skill-row')).toContainText('architect')
    await page.locator('.skill-row').getByRole('button', { name: 'Copy path' }).click()
    expect(await page.evaluate(() => window.gridApi.readClipboard())).toEqual({ kind: 'text', text: codexAgent })
    await page.getByRole('button', { name: 'All agents', exact: true }).click()
    await expect(page.locator('.skill-row')).toHaveCount(2)
    await page.getByRole('button', { name: 'Installed skills' }).click()
    await expect(page.locator('.skill-row')).toHaveCount(2)
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog
    })
    await page.locator('.skill-row').first().getByRole('button', { name: 'Export' }).click()
    await expect(page.locator('.skill-row').first().locator('.skill-feedback')).toBeEmpty()
    await page.setViewportSize({ width: 960, height: 600 })
    expect(await page.locator('.topbar').evaluate((bar) => bar.scrollWidth <= bar.clientWidth)).toBe(true)
  } finally {
    await closeApp(app)
  }
})
