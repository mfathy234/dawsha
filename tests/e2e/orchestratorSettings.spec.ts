import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp, openMore } from './helpers'

const shots = resolve(__dirname, '../../test-results/orch-ui-simplify-shots')

for (const theme of ['dawsha-night', 'dawsha-daylight']) {
  test(`Orchestrator settings shows the team and keeps advanced edits available in ${theme}`, async () => {
    const sandbox = createSandbox()
    writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
      version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true,
      theme: { id: theme }, experimental: { orchestrator: true },
      projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }]
    }))
    const { app, page } = await launchApp(sandbox)
    const shot = async (name: string): Promise<void> => {
      mkdirSync(shots, { recursive: true })
      await page.screenshot({ path: join(shots, `${name}-${theme}.png`), animations: 'disabled' })
    }
    try {
      await openMore(page, 'orchestrator')
      await page.locator('#orch-tab-new').click()
      await expect(page.locator('#orch-nr-plans')).toContainText('Lead: opus')
      await expect(page.locator('#orch-nr-plans')).toContainText('team picked by the lead')
      await shot('new-run-feature')
      await page.getByRole('button', { name: 'Project', exact: true }).click()
      await shot('dropdown-open')
      await page.keyboard.press('Escape')
      await page.locator('#orch-nr-kind-bug').click()
      // A bug has one agent, so the only choice is Claude or Codex.
      await expect(page.locator('#orch-nr-fixer [role="radio"]')).toHaveText([/Claude/, /Codex/])
      await expect(page.locator('#orch-nr-fixer-claude')).toHaveAttribute('aria-checked', 'true')
      await expect(page.locator('#orch-nr-fixer-claude')).toContainText('opus')
      await page.locator('#orch-nr-fixer-codex').click()
      await expect(page.locator('#orch-nr-fixer-codex')).toHaveAttribute('aria-checked', 'true')
      await expect(page.locator('#orch-nr-fixer-claude')).toHaveAttribute('aria-checked', 'false')
      await shot('new-run-bug')
      await page.locator('#orch-nr-kind-feature').click()
      await page.locator('#orch-nr-open-plans').click()
      const advanced = page.locator('.orch-set-advanced')
      await expect(advanced).not.toHaveAttribute('open', '')
      await expect(page.locator('#orch-set-profile-name')).toBeHidden()
      await expect(page.locator('.orch-set-team')).toContainText("Uses the lead's model")
      await expect(page.locator('.orch-set-team .select-menu-trigger:visible')).toHaveCount(0)
      await expect(page.locator('.orch-set-actions #orch-set-plan-default')).toBeDisabled()
      await expect(page.locator('.orch-set-actions #orch-set-plan-default')).toHaveText('Default plan')
      await expect(page.locator('.orch-set-chip.selected')).toContainText('Default for new runs')
      await shot('settings')
      await page.locator('.orch-set-team-row').filter({ has: page.getByText('Lead', { exact: true }) }).getByRole('button', { name: 'Change', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Lead profile', exact: true })).toBeFocused()
      await page.getByRole('button', { name: 'Lead profile', exact: true }).click()
      await expect(page.getByRole('listbox', { name: 'Lead profile', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await page.locator('#orch-set-plan-new').click()
      await page.locator('#orch-set-plan-name').fill('My team')
      await page.locator('#orch-set-plan-name').press('Tab')
      await page.locator('.orch-set-actions #orch-set-plan-default').click()
      await expect(page.locator('.orch-set-actions #orch-set-plan-default')).toBeDisabled()
      await page.locator('#orch-set-plan-workers').fill('999')
      await page.locator('#orch-set-plan-workers').press('Tab')
      await expect(page.locator('#orch-set-plan-workers')).toHaveValue('5')
      await advanced.locator('summary').click()
      await page.locator('#orch-set-profile-new').click()
      await expect(advanced).toHaveAttribute('open', '')
      await page.locator('#orch-set-profile-model').fill('custom-model')
      await page.locator('#orch-set-profile-model').press('Tab')
      await expect(page.locator('.orch-set-prices')).toContainText('custom-model')
      await page.locator('#orch-set-role-lead-change').click()
      await page.getByRole('button', { name: 'Lead profile', exact: true }).click()
      await page.getByRole('option', { name: 'New profile', exact: true }).click()
      await expect(page.locator('.orch-set-team-row').first()).toContainText('custom-model')
      await expect(page.locator('#orch-set-role-lead-change')).toBeFocused()
      await page.locator('#settings-orchestrator-trust').uncheck()
      await page.locator('#settings-button').click()
      await page.locator('#settings-button').click()
      await expect(page.locator('#settings-orchestrator-trust')).not.toBeChecked()
      await page.locator('#settings-button').click()
      await openMore(page, 'orchestrator')
      await page.locator('#orch-tab-boards').click()
      await shot('boards')
      await page.locator('#orch-tab-history').click()
      await shot('history')
    } finally { await closeApp(app) }
  })
}

test('the orchestrator is a normal feature: on for settings that turned it off, with no Experimental section', async () => {
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true, experimental: { orchestrator: false },
    projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }]
  }))
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#more-button').click()
    await expect(page.locator('#orchestrator-menu-item')).toBeVisible()
    await page.keyboard.press('Escape')
    await openMore(page, 'orchestrator')
    await expect(page.locator('#orch-tab-new')).toBeVisible()
    await page.locator('#settings-button').click()
    const nav = page.locator('.settings-nav')
    await expect(nav).toContainText('Orchestrator')
    await expect(nav).not.toContainText('Experimental')
  } finally { await closeApp(app) }
})
