import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createFakeTools } from '../support/fakeTools'
import { closeApp, createSandbox, launchApp } from './helpers'

test('a pane shows native activity without a Claude ops mod', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const toggle = page.locator('.pane .agents-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(page.locator('.pane .agents-drawer')).toBeVisible()
    await expect(page.locator('.pane .agents-drawer')).toContainText('Processes')
    await expect(page.locator('.pane .agents-drawer .process-item').first()).toBeVisible({ timeout: 20_000 })
  } finally {
    await closeApp(app)
  }
})

function fakeEnv(installed: Parameters<typeof createFakeTools>[1]) {
  const dir = mkdtempSync(join(tmpdir(), 'dawsha-fake-'))
  const tools = createFakeTools(dir, installed, { claude: '2.1.301', codex: '0.156.1', gemini: '0.9.1' })
  const env = {
    PATH: `${tools.pathEntry}${delimiter}${process.env.PATH ?? ''}`,
    DAWSHA_CLAUDE_COMMAND: tools.commands.claude,
    DAWSHA_CODEX_COMMAND: tools.commands.codex,
    DAWSHA_GEMINI_COMMAND: tools.commands.gemini
  }
  return { tools, env }
}

const row = (page: import('@playwright/test').Page, agent: string) => page.locator(`.tool-block[data-agent="${agent}"]`)

test('Agents view shows versions, installs and updates in a visible tab and re-checks', async () => {
  const { env } = fakeEnv({ claude: '2.1.294', codex: '0.156.1', gemini: null })
  const { app, page } = await launchApp(createSandbox(), env)
  try {
    await expect(page.locator('#more-button .update-dot')).toBeVisible()
    await page.locator('#more-button').click()
    await page.locator('#agents-menu-item').click()
    await expect(page.locator('.agents-view')).toBeVisible()

    await expect(row(page, 'claude').locator('.tool-versions')).toContainText('Installed2.1.294')
    await expect(row(page, 'claude').locator('.tool-versions')).toContainText('Latest2.1.301')
    await expect(row(page, 'claude').locator('.tool-flag.update')).toHaveText('Update ready')
    await expect(row(page, 'claude').getByRole('button', { name: 'Update Claude Code' })).toHaveText('Update to 2.1.301')
    await expect(row(page, 'codex').locator('.tool-flag.current')).toHaveText('Up to date')
    await expect(row(page, 'codex').getByRole('button', { name: 'Reinstall Codex CLI' })).toBeEnabled()
    await expect(row(page, 'gemini').locator('.tool-status')).toContainText('Not installed')
    await expect(row(page, 'gemini')).toHaveClass(/missing/)
    await expect(page.locator('#agents-update-all')).toBeEnabled()
    await expect(page.locator('#agents-update-all')).toHaveText('Update 1 agent')

    await row(page, 'gemini').getByRole('button', { name: 'Show command' }).click()
    await expect(row(page, 'gemini').locator('.tool-command')).toHaveText('npm install -g @google/gemini-cli@latest')
    await row(page, 'gemini').getByRole('button', { name: 'Hide command' }).click()

    await row(page, 'gemini').getByRole('button', { name: 'Install Gemini CLI' }).click()
    await expect(page.locator('.pane-title')).toHaveText('1 · Agents')
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['install gemini'])
    await expect(page.locator('.toast.info')).toContainText('Gemini CLI 0.9.1 installed.', { timeout: 30_000 })

    await page.locator('#more-button').click()
    await page.locator('#agents-menu-item').click()
    await expect(row(page, 'gemini').locator('.tool-flag.current')).toBeVisible()

    await page.locator('#agents-update-all').click()
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['install gemini', 'update claude'])
    await expect(page.locator('.toast.info').last()).toContainText('Claude Code updated to 2.1.301.', { timeout: 30_000 })
    await page.locator('#more-button').click()
    await page.locator('#agents-menu-item').click()
    await expect(row(page, 'claude').locator('.tool-flag.current')).toBeVisible()
    await expect(page.locator('#agents-update-all')).toBeDisabled()
    await expect(page.locator('#more-button .update-dot')).toBeHidden()
  } finally {
    await closeApp(app)
  }
})

test('a failed install reports the exit code and keeps the tab', async () => {
  const { tools, env } = fakeEnv({ claude: '2.1.301', codex: '0.156.1', gemini: null })
  tools.failInstalls()
  const { app, page } = await launchApp(createSandbox(), env)
  try {
    await page.locator('#more-button').click()
    await page.locator('#agents-menu-item').click()
    await row(page, 'gemini').getByRole('button', { name: 'Install Gemini CLI' }).click()
    await expect(page.locator('.toast.error')).toContainText('Gemini CLI was not installed (exit code 1)', { timeout: 30_000 })
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['install gemini'])
  } finally {
    await closeApp(app)
  }
})

test('full access starts on for Claude and Codex, off for Gemini, and the choice is saved', async () => {
  const { env } = fakeEnv({ claude: '2.1.301', codex: '0.156.1', gemini: '0.9.1' })
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, env)
  try {
    await page.locator('#more-button').click()
    await page.locator('#agents-menu-item').click()
    await expect(row(page, 'claude').getByLabel('Start with full access')).toBeChecked({ timeout: 20_000 })
    await expect(row(page, 'codex').getByLabel('Start with full access')).toBeChecked()
    await expect(row(page, 'gemini').getByLabel('Start with full access')).not.toBeChecked()
    await expect(row(page, 'codex')).toContainText('--dangerously-bypass-approvals-and-sandbox')
    await expect(row(page, 'claude').locator('.agent-mark svg')).toHaveCount(1)

    await row(page, 'codex').getByLabel('Start with full access').uncheck()
    await row(page, 'gemini').getByLabel('Start with full access').check()
    const settings = () => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))
    await expect.poll(() => settings().fullAccess, { timeout: 30_000 }).toEqual({ claude: true, codex: false, gemini: true })
    await page.screenshot({ path: 'test-results/screens/40-agents-full-access.png' })
  } finally {
    await closeApp(app)
  }
})
