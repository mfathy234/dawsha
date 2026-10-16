import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
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
