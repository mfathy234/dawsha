import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createFakeTools } from '../support/fakeTools'
import { closeApp, createSandbox, launchApp } from './helpers'

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

test('Agent tools view shows versions, installs and updates in a visible tab and re-checks', async () => {
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
    await expect(page.locator('.pane-title')).toHaveText('1 · Agent tools')
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

test('an existing npm Claude is updated with npm and never offered the native installer', async () => {
  const { env } = fakeEnv({ claude: '2.1.294', codex: '0.156.1', gemini: '0.9.1' })
  const { app, page } = await launchApp(createSandbox(), env)
  try {
    await page.locator('#more-button').click()
    await page.locator('#agents-menu-item').click()
    await expect(row(page, 'claude').locator('.tool-source')).toHaveText('npm @anthropic-ai/claude-code')
    await row(page, 'claude').getByRole('button', { name: 'Show command' }).click()
    await expect(row(page, 'claude').locator('.tool-command')).toHaveText('npm install -g @anthropic-ai/claude-code@latest')
    await expect(row(page, 'claude').locator('.tool-conflict')).toHaveCount(0)
    await row(page, 'claude').getByRole('button', { name: 'Update Claude Code' }).click()
    await expect(page.locator('.toast.info')).toContainText('Claude Code updated to 2.1.301.', { timeout: 30_000 })
    await expect(page.locator('.tabs [role="tab"]')).toHaveText(['update claude'])
  } finally {
    await closeApp(app)
  }
})

function claudeLayout(root: string, installs: { npm: boolean; native: boolean }) {
  const home = join(root, 'home')
  const prefix = join(home, 'AppData', 'Roaming', 'npm')
  const nativeBin = join(home, '.local', 'bin')
  if (installs.npm) {
    const bin = join(prefix, 'node_modules', '@anthropic-ai', 'claude-code', 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'claude.exe'), 'MZ')
    writeFileSync(
      join(prefix, 'claude.cmd'),
      ['@ECHO off', String.raw`REM "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"`, 'echo 2.1.289 (Claude Code)', ''].join('\r\n')
    )
  }
  if (installs.native) {
    mkdirSync(nativeBin, { recursive: true })
    writeFileSync(join(nativeBin, 'claude.exe'), 'MZ')
  }
  return { home, prefix, nativeBin }
}

function isolatedEnv(root: string, home: string) {
  const { env } = fakeEnv({ claude: null, codex: '0.156.1', gemini: '0.9.1' })
  return {
    ...env,
    DAWSHA_CLAUDE_COMMAND: '',
    npm_config_prefix: '',
    NPM_CONFIG_PREFIX: '',
    PATH: env.PATH.split(delimiter)[0],
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local')
  }
}

test('Claude installed with npm outside the app PATH is found and updated, not reinstalled', async () => {
  test.skip(process.platform !== 'win32', 'the fake npm layout is the Windows one')
  const sandbox = createSandbox()
  const { home } = claudeLayout(sandbox.root, { npm: true, native: false })
  const { app, page } = await launchApp(sandbox, isolatedEnv(sandbox.root, home))
  try {
    await page.locator('#more-button').click()
    await page.locator('#agents-menu-item').click()
    await expect(row(page, 'claude')).toBeVisible({ timeout: 20_000 })
    await expect(row(page, 'claude')).not.toHaveClass(/missing/)
    await expect(row(page, 'claude').locator('.tool-source')).toHaveText('npm @anthropic-ai/claude-code')
    await expect(row(page, 'claude').locator('.tool-versions')).toContainText('Installed2.1.289')
    await row(page, 'claude').getByRole('button', { name: 'Show command' }).click()
    await expect(row(page, 'claude').locator('.tool-command')).toHaveText('npm install -g @anthropic-ai/claude-code@latest')
  } finally {
    await closeApp(app)
  }
})

test('two Claude installs show a warning naming both and offer no install or update', async () => {
  test.skip(process.platform !== 'win32', 'the fake npm layout is the Windows one')
  const sandbox = createSandbox()
  const { home, prefix, nativeBin } = claudeLayout(sandbox.root, { npm: true, native: true })
  const { app, page } = await launchApp(sandbox, isolatedEnv(sandbox.root, home))
  try {
    await page.locator('#more-button').click()
    await page.locator('#agents-menu-item').click()
    const notice = row(page, 'claude').locator('.tool-conflict')
    await expect(notice).toContainText('Two Claude Code installs found')
    await expect(notice).toContainText(join(prefix, 'claude.cmd'))
    await expect(notice).toContainText(join(nativeBin, 'claude.exe'))
    await expect(notice).toContainText('npm uninstall -g')
    await expect(row(page, 'claude').getByRole('button', { name: 'Update Claude Code' })).toBeDisabled()
    await expect(row(page, 'claude').getByRole('button', { name: 'Show command' })).toHaveCount(0)
    await expect(page.locator('#agents-update-all')).toBeDisabled()
    await expect(page.locator('.tabs [role="tab"]')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
