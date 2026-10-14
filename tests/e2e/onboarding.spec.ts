import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createFakeTools } from '../support/fakeTools'
import { closeApp, createSandbox, launchApp, openSettings, runCli, QUIT_BUDGET_MS } from './helpers'

const SCREENS = 'test-results/screens'
const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

function toolsEnv(): Record<string, string> {
  const tools = createFakeTools(
    mkdtempSync(join(tmpdir(), 'dawsha-onboarding-')),
    { claude: '2.1.301', codex: null, gemini: null },
    { claude: '2.1.301', codex: '0.156.1', gemini: '0.9.1' }
  )
  return {
    PATH: `${tools.pathEntry}${delimiter}${process.env.PATH ?? ''}`,
    DAWSHA_CLAUDE_COMMAND: tools.commands.claude,
    DAWSHA_CODEX_COMMAND: tools.commands.codex,
    DAWSHA_GEMINI_COMMAND: tools.commands.gemini
  }
}

test('first run shows the setup steps, marks them done and remembers the dismissal', async () => {
  const sandbox = createSandbox({ empty: true })
  const first = await launchApp(sandbox, toolsEnv())
  try {
    const dialog = first.page.getByRole('dialog', { name: 'Set up Dawsha' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.ob-step')).toHaveCount(3)
    await expect(dialog.locator('.ob-step[data-step="1"]')).not.toHaveClass(/done/)
    await expect(dialog.locator('#ob-progress-label')).toHaveText('1 of 3')
    await expect(dialog.locator('.ob-agent[data-agent="claude"]')).toContainText('Ready 2.1.301')
    await expect(dialog.locator('.ob-agent[data-agent="codex"]').getByRole('button', { name: 'Install Codex CLI' })).toBeVisible()
    await expect(dialog.locator('.ob-agent[data-agent="gemini"]').getByRole('button', { name: 'Install Gemini CLI' })).toBeVisible()
    await expect(dialog.locator('.ob-step[data-step="2"]')).toHaveClass(/done/)
    await expect(dialog.locator('.ob-step[data-step="3"]')).toHaveClass(/locked/)
    await expect(dialog.locator('#ob-start')).toBeDisabled()
    await expect(dialog).toContainText('Tip: run dawsha . in any folder to open it here.')
    await expect(dialog).toContainText('Everything stays on this computer.')
    await expect(dialog).not.toContainText('Connect Claude Code')
    await expect(dialog.locator('#ob-close')).toHaveText('Skip')
    await first.page.screenshot({ path: join(SCREENS, '23-onboarding.png') })

    const added = await runCli(sandbox, ['add', sandbox.projectFolder, '--name', 'acme-web'])
    expect(added.code).toBe(0)
    await expect(dialog.locator('.ob-step[data-step="1"]')).toHaveClass(/done/)
    await expect(dialog.locator('.ob-step[data-step="1"]')).toContainText('acme-web')
    await expect(dialog.locator('#ob-progress-label')).toHaveText('2 of 3')
    await expect(dialog.locator('.ob-step[data-step="3"]')).toHaveClass(/active/)
    await expect(dialog.locator('#ob-start')).toHaveText('Start Claude Code in acme-web')
    await expect(dialog.locator('#ob-close')).toHaveText('Done')
    await dialog.locator('#ob-close').click()
    await expect(first.page.locator('.onboarding')).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox.userData).onboardingDismissed).toBe(true)
  } finally {
    expect(await closeApp(first.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('skipping keeps the setup closed on the next start and Getting started reopens it', async () => {
  const sandbox = createSandbox({ empty: true })
  const first = await launchApp(sandbox)
  try {
    await expect(first.page.locator('.onboarding')).toBeVisible()
    await first.page.keyboard.press('Escape')
    await expect(first.page.locator('.onboarding')).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox.userData).onboardingDismissed).toBe(true)
  } finally {
    await closeApp(first.app)
  }

  const second = await launchApp(sandbox)
  try {
    await expect(second.page.locator('.empty h2')).toHaveText('Add a project to get started')
    await expect(second.page.locator('.onboarding')).toHaveCount(0)
    await openSettings(second.page, 'general')
    await second.page.locator('#getting-started').click()
    await expect(second.page.getByRole('dialog', { name: 'Set up Dawsha' })).toBeVisible()
    await second.page.locator('#ob-open-agents').click()
    await expect(second.page.locator('.onboarding')).toHaveCount(0)
    await expect(second.page.locator('.agents-view')).toBeVisible()
  } finally {
    await closeApp(second.app)
  }
})

test('an existing install with projects never sees the setup', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(page.locator('.empty h2')).toHaveText('No sessions yet')
    await expect(page.locator('.onboarding')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
