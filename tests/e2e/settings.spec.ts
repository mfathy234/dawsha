import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createFakeTools } from '../support/fakeTools'
import { APP_VERSION, closeApp, closeSettings, createSandbox, launchApp, openSettings, type SettingsSectionId } from './helpers'

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

function fakeEnv(): Record<string, string> {
  const tools = createFakeTools(
    mkdtempSync(join(tmpdir(), 'dawsha-settings-')),
    { claude: '2.1.301', codex: '0.156.1', gemini: '0.9.1' },
    { claude: '2.1.301', codex: '0.156.1', gemini: '0.9.1' }
  )
  return {
    PATH: `${tools.pathEntry}${delimiter}${process.env.PATH ?? ''}`,
    DAWSHA_CLAUDE_COMMAND: tools.commands.claude,
    DAWSHA_CODEX_COMMAND: tools.commands.codex,
    DAWSHA_GEMINI_COMMAND: tools.commands.gemini
  }
}

test('Settings opens from the top bar and with Ctrl+comma, and every section renders', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(page.locator('.settings-view')).toBeHidden()
    await page.locator('#settings-button').click()
    await expect(page.locator('.settings-view')).toBeVisible()
    await expect(page.locator('#settings-button')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.settings-view h1')).toHaveText('Settings')
    await page.locator('#settings-button').click()
    await expect(page.locator('.settings-view')).toBeHidden()

    await page.keyboard.press('Control+,')
    await expect(page.locator('.settings-view')).toBeVisible()
    await closeSettings(page)

    await page.keyboard.press('Control+k')
    await page.locator('.palette input').fill('Open Settings')
    await expect(page.locator('.palette')).toContainText('Ctrl+,')
    await page.keyboard.press('Enter')
    await expect(page.locator('.settings-view')).toBeVisible()

    const expected: Record<SettingsSectionId, string> = {
      general: '#palette-shortcut',
      notifications: '#bridge-toggle',
      agents: '#settings-full-access-claude',
      updates: '#check-now',
      highlights: '#highlights-toggle',
      changelog: '#changelog-list',
      about: '#open-data-folder'
    }
    for (const [section, selector] of Object.entries(expected)) {
      await openSettings(page, section as SettingsSectionId)
      await expect(page.locator(selector)).toBeVisible()
    }
    await page.screenshot({ path: 'test-results/screens/50-settings-about.png' })

    await openSettings(page, 'general')
    await page.locator('#settings-tab-general').focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('#settings-tab-notifications')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#settings-tab-notifications')).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.locator('#settings-tab-about')).toHaveAttribute('aria-selected', 'true')
  } finally {
    await closeApp(app)
  }
})

test('the Theme menu keeps only the theme and the background image', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'Theme' }).click()
    await expect(page.locator('.theme-picker')).toBeVisible()
    await expect(page.locator('#image-enabled')).toBeVisible()
    for (const id of ['#bridge-toggle', '#notify-toggle', '#sound-toggle', '#auto-update-toggle', '#check-now', '#whats-new', '#getting-started']) {
      await expect(page.locator('.theme-picker').locator(id)).toHaveCount(0)
    }
  } finally {
    await closeApp(app)
  }
})

test('the palette shortcut validates, persists to settings.json and resets', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'general')
    const input = page.locator('#palette-shortcut')
    await expect(input).toHaveValue('Ctrl+K')
    await expect(page.locator('#palette-shortcut-reset')).toBeDisabled()

    await input.fill('Space')
    await input.press('Enter')
    await expect(page.locator('#palette-shortcut-error')).toContainText('not a valid shortcut')
    await expect(input).toHaveClass(/invalid/)
    expect(readSettings(sandbox.userData).paletteShortcut ?? 'Ctrl+K').toBe('Ctrl+K')

    await input.fill('')
    await input.press('Enter')
    await expect(page.locator('#palette-shortcut-error')).toContainText('Enter a shortcut')

    await input.fill('ctrl+shift+j')
    await expect(page.locator('#palette-shortcut-error')).toHaveCount(0)
    await input.press('Enter')
    await expect(input).toHaveValue('Ctrl+Shift+J')
    await expect.poll(() => readSettings(sandbox.userData).paletteShortcut).toBe('Ctrl+Shift+J')

    await closeSettings(page)
    await page.keyboard.press('Control+Shift+J')
    await expect(page.locator('.palette')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.palette')).toHaveCount(0)

    await openSettings(page, 'general')
    await page.locator('#palette-shortcut-reset').click()
    await expect(page.locator('#palette-shortcut')).toHaveValue('Ctrl+K')
    await expect.poll(() => readSettings(sandbox.userData).paletteShortcut).toBe('Ctrl+K')
  } finally {
    await closeApp(app)
  }
})

test('sidebar and notification toggles persist, and Getting started opens from General', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'general')
    await page.locator('#sidebar-collapsed').check()
    await expect.poll(() => readSettings(sandbox.userData).sidebarCollapsed).toBe(true)
    await page.locator('#getting-started').click()
    await expect(page.getByRole('dialog', { name: 'Set up Dawsha' })).toBeVisible()
    await page.keyboard.press('Escape')

    await openSettings(page, 'notifications')
    await page.locator('#notify-toggle').click()
    await expect(page.locator('#sound-toggle')).toBeDisabled()
    await expect.poll(() => readSettings(sandbox.userData).sessionInfo?.notifications).toBe(false)
  } finally {
    await closeApp(app)
  }
})

test('full access toggles in Settings and the Agents view stay in sync', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, fakeEnv())
  try {
    await openSettings(page, 'agents')
    await expect(page.locator('#settings-full-access-claude')).toBeChecked()
    await expect(page.locator('#settings-full-access-gemini')).not.toBeChecked()
    await page.locator('#settings-full-access-claude').uncheck()
    await page.locator('#settings-full-access-gemini').check()
    await expect.poll(() => readSettings(sandbox.userData).fullAccess, { timeout: 30_000 }).toEqual({ claude: false, codex: true, gemini: true })

    await page.locator('#settings-manage-agents').click()
    await expect(page.locator('.agents-view')).toBeVisible()
    const block = (agent: string) => page.locator(`.tool-block[data-agent="${agent}"]`)
    await expect(block('claude').getByLabel('Start with full access')).not.toBeChecked({ timeout: 20_000 })
    await expect(block('gemini').getByLabel('Start with full access')).toBeChecked()

    await block('codex').getByLabel('Start with full access').uncheck()
    await expect.poll(() => readSettings(sandbox.userData).fullAccess.codex, { timeout: 30_000 }).toBe(false)
    await openSettings(page, 'agents')
    await expect(page.locator('#settings-full-access-codex')).not.toBeChecked()
  } finally {
    await closeApp(app)
  }
})

test('the changelog lists every version newest first and the What is new dialog opens it', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'changelog')
    const versions = await page.locator('#changelog-list .wn-entry').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-version') ?? ''))
    expect(versions.length).toBeGreaterThanOrEqual(1)
    expect(versions[0]).toBe(APP_VERSION)
    expect(new Set(versions).size).toBe(versions.length)
    await expect(page.locator(`#changelog-list .wn-entry[data-version="${APP_VERSION}"] .cl-current`)).toHaveText('current')
    await expect(page.locator('#changelog-list .cl-current')).toHaveCount(1)

    await page.screenshot({ path: 'test-results/screens/51-settings-changelog.png' })
    await closeSettings(page)
    await page.keyboard.press('Control+k')
    await page.locator('.palette input').fill("Show what's new")
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: `What's new in Dawsha ${APP_VERSION}` })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Full changelog' }).click()
    await expect(page.locator('.whats-new')).toHaveCount(0)
    await expect(page.locator('.settings-view')).toBeVisible()
    await expect(page.locator('#settings-tab-changelog')).toHaveAttribute('aria-selected', 'true')
  } finally {
    await closeApp(app)
  }
})

test('About shows the version, the data paths and opens links and the data folder', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'about')
    await expect(page.locator('#about-version')).toHaveText(APP_VERSION)
    await expect(page.locator('#about-user-data')).toHaveText(sandbox.userData)
    await expect(page.locator('#about-settings-file')).toContainText('settings.json')

    await page.locator('#open-data-folder').click()
    await page.locator('#settings-link-repo').click()
    await page.locator('#settings-link-releases').click()
    await page.locator('#settings-link-license').click()
    await expect
      .poll(() =>
        readFileSync(sandbox.openLog, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      )
      .toEqual([
        { kind: 'explorer', folder: sandbox.userData },
        { link: 'https://github.com/mfathy234/dawsha' },
        { link: 'https://github.com/mfathy234/dawsha/releases' },
        { link: 'https://github.com/mfathy234/dawsha/blob/main/LICENSE' }
      ])
  } finally {
    await closeApp(app)
  }
})
