import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp, openSettings, type Sandbox } from './helpers'

const RELEASE_URL = 'https://github.com/mfathy234/dawsha/releases/tag/v9.9.0'
const NOTES = [
  '### Added',
  '',
  '- Dark mode toggle for acme-web',
  '- <script>window.__pwned = 1</script> and [elsewhere](https://evil.example/x)',
  '',
  '### Fixed',
  '',
  `- Release notes link: [v9.9.0](${RELEASE_URL})`
].join('\n')

interface Script {
  check?: 'available' | 'none' | 'error'
  info?: { version: string; releaseDate?: string; releaseNotes?: string }
  checkError?: string
  download?: 'ok' | 'error'
  downloadError?: string
  progress?: number[]
  hold?: boolean
}

interface Hook {
  checks: number
  downloads: number
  setScript(script: Script): void
  release(): void
}

const AVAILABLE: Script = {
  check: 'available',
  info: { version: '9.9.0', releaseDate: '2026-11-01T10:00:00.000Z', releaseNotes: NOTES },
  progress: [10, 42],
  hold: true
}

const readSettings = (sandbox: Sandbox): any => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))

const lines = (file: string): string[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [])

function updaterEnv(sandbox: Sandbox, script: Script, extra: Record<string, string> = {}): Record<string, string> {
  return {
    DAWSHA_TEST_UPDATER: 'fake',
    DAWSHA_TEST_UPDATER_SCRIPT: JSON.stringify(script),
    DAWSHA_TEST_UPDATER_LOG: join(sandbox.root, 'updater.log'),
    DAWSHA_UPDATE_START_DELAY_MS: '200',
    DAWSHA_UPDATE_INTERVAL_MS: '3600000',
    ...extra
  }
}

const hookCall = <T>(app: ElectronApplication, run: string): Promise<T> =>
  app.evaluate((_electron, code) => {
    const hook = (globalThis as unknown as { __dawshaFakeUpdater: Hook }).__dawshaFakeUpdater
    return new Function('hook', `return (${code})`)(hook)
  }, run) as Promise<T>

const setScript = (app: ElectronApplication, script: Script): Promise<void> =>
  hookCall<void>(app, `hook.setScript(${JSON.stringify(script)})`)

const pill = (page: Page) => page.locator('#update-pill')

async function openPopover(page: Page): Promise<void> {
  if ((await page.locator('.update-popover').count()) === 0) await pill(page).click()
  await expect(page.locator('.update-popover')).toBeVisible()
}

function exited(app: ElectronApplication): Promise<void> {
  return new Promise((resolve) => app.process().once('exit', () => resolve()))
}

test('an update walks from available to downloading to ready and restarts through quitAndInstall', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, updaterEnv(sandbox, AVAILABLE, { DAWSHA_OPEN_LOG: join(sandbox.root, 'open.log') }))
  try {
    await expect(pill(page)).toHaveText('Update 9.9.0')
    await expect(pill(page)).toHaveClass(/status-available/)
    await pill(page).click()
    const popover = page.locator('.update-popover')
    await expect(popover.locator('.update-title')).toHaveText('Dawsha 9.9.0 is available')
    const version = APP_VERSION
    await expect(popover.locator('.update-sub')).toContainText(`You have ${version} · released`)
    await expect(popover.locator('#update-notes')).toContainText('Dark mode toggle for acme-web')
    await expect(popover.locator('#update-notes script')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
    await expect(popover.locator('#update-notes a')).toHaveCount(1)
    await expect(popover).toContainText('Downloads in the background. Your sessions keep running until you restart.')

    await popover.locator('#update-notes a').click()
    await popover.locator('#update-view').click()
    await expect.poll(() => lines(sandbox.openLog).length).toBe(2)
    expect(lines(sandbox.openLog).map((line) => JSON.parse(line).link)).toEqual([RELEASE_URL, RELEASE_URL])

    await popover.locator('#update-now').click()
    await expect(pill(page)).toHaveText('Downloading 9.9.0 42%')
    await expect(pill(page).locator('.pill-line')).toHaveCSS('width', /^[1-9]/)
    await page.screenshot({ path: 'test-results/screens/30-update-downloading.png' })
    await hookCall<void>(app, 'hook.release()')
    await expect(pill(page)).toHaveText('Restart to update')
    await expect(pill(page)).toHaveClass(/status-ready/)

    await openPopover(page)
    await expect(page.locator('.update-popover .update-title')).toHaveText(
      'Dawsha 9.9.0 is ready. Restart now, or it installs when you quit.'
    )
    await expect(page.locator('.update-popover')).toContainText('Open sessions reopen after the restart')
    const gone = exited(app)
    await page.locator('#update-restart').click()
    await gone
    expect(lines(join(sandbox.root, 'updater.log'))).toEqual(['quitAndInstall true true'])
  } finally {
    await closeApp(app)
  }
})

test('When I quit hides the pill and the install runs as the app quits', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, updaterEnv(sandbox, { ...AVAILABLE, hold: false }))
  try {
    await pill(page).click()
    await page.locator('#update-now').click()
    await expect(pill(page)).toHaveText('Restart to update')
    await openPopover(page)
    await page.locator('#update-quit').click()
    await expect(pill(page)).toBeHidden()
    await expect(page.locator('.update-popover')).toHaveCount(0)
    expect(lines(join(sandbox.root, 'updater.log'))).toEqual([])
  } finally {
    await closeApp(app)
  }
  expect(lines(join(sandbox.root, 'updater.log'))).toEqual(['quitAndInstall true false'])
})

test('a failed download shows Update failed, retries and opens GitHub', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(
    sandbox,
    updaterEnv(sandbox, { ...AVAILABLE, hold: false, download: 'error', downloadError: 'Disk is full' }, { DAWSHA_OPEN_LOG: join(sandbox.root, 'open.log') })
  )
  try {
    await pill(page).click()
    await page.locator('#update-now').click()
    await expect(pill(page)).toHaveText('Update failed')
    await expect(pill(page)).toHaveClass(/status-error/)
    await openPopover(page)
    await expect(page.locator('#update-error')).toHaveText('Disk is full')
    await page.screenshot({ path: 'test-results/screens/31-update-failed.png' })

    await page.locator('#update-github').click()
    await expect.poll(() => lines(sandbox.openLog).length).toBe(1)
    expect(JSON.parse(lines(sandbox.openLog)[0]).link).toBe('https://github.com/mfathy234/dawsha/releases/latest')

    await setScript(app, { ...AVAILABLE, hold: false, download: 'ok' })
    await page.locator('#update-retry').click()
    await expect(pill(page)).toHaveText('Restart to update')
    expect(await hookCall<number>(app, 'hook.downloads')).toBe(2)
  } finally {
    await closeApp(app)
  }
})

test('a failed manual check shows Update failed and Try again checks again', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, updaterEnv(sandbox, { check: 'error', checkError: 'Network unreachable' }, { DAWSHA_UPDATE_START_DELAY_MS: '3600000' }))
  try {
    await expect(pill(page)).toBeHidden()
    await openSettings(page, 'updates')
    await page.locator('#check-now').click()
    await expect(pill(page)).toHaveText('Update failed')
    await openPopover(page)
    await expect(page.locator('#update-error')).toHaveText('Network unreachable')
    await setScript(app, { check: 'none' })
    await page.locator('#update-retry').click()
    await expect(pill(page)).toBeHidden()
  } finally {
    await closeApp(app)
  }
})

test('Later hides the pill until a newer version than the dismissed one is found', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, updaterEnv(sandbox, AVAILABLE))
  try {
    await expect(pill(page)).toHaveText('Update 9.9.0')
    await pill(page).click()
    await page.locator('#update-later').click()
    await expect(pill(page)).toBeHidden()
    await expect(page.locator('.update-popover')).toHaveCount(0)

    await openSettings(page, 'updates')
    await page.locator('#check-now').click()
    await expect.poll(() => hookCall<number>(app, 'hook.checks')).toBe(2)
    await expect(page.locator('#update-status')).toContainText('update available')
    await expect(pill(page)).toBeHidden()

    await setScript(app, { ...AVAILABLE, info: { version: '9.9.1', releaseNotes: '### Fixed\n\n- A fix' } })
    await page.locator('#check-now').click()
    await expect(pill(page)).toHaveText('Update 9.9.1')
  } finally {
    await closeApp(app)
  }
})

test('the portable build points to GitHub and never downloads', async () => {
  const sandbox = createSandbox()
  const portableDir = mkdtempSync(join(tmpdir(), 'dawsha-portable-'))
  const { app, page } = await launchApp(
    sandbox,
    updaterEnv(sandbox, AVAILABLE, { PORTABLE_EXECUTABLE_DIR: portableDir, DAWSHA_OPEN_LOG: join(sandbox.root, 'open.log') })
  )
  try {
    await expect(pill(page)).toHaveText('Update 9.9.0')
    await pill(page).click()
    const popover = page.locator('.update-popover')
    await expect(popover.locator('.update-title')).toHaveText("Dawsha 9.9.0 is available. The portable version can't update itself.")
    await expect(popover.locator('#update-now')).toHaveCount(0)
    await expect(popover.getByRole('button', { name: 'Later' })).toBeVisible()
    await popover.getByRole('button', { name: 'Download from GitHub' }).click()
    await expect.poll(() => lines(sandbox.openLog).length).toBe(1)
    expect(JSON.parse(lines(sandbox.openLog)[0]).link).toBe(RELEASE_URL)
    expect(await hookCall<number>(app, 'hook.downloads')).toBe(0)

    await openSettings(page, 'updates')
    await expect(page.locator('#update-status')).toContainText('portable build: updates from GitHub')
  } finally {
    await closeApp(app)
  }
})

test('turning off automatic checks stops the schedule, Check now still works', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(
    sandbox,
    updaterEnv(sandbox, { check: 'none' }, { DAWSHA_UPDATE_START_DELAY_MS: '150', DAWSHA_UPDATE_INTERVAL_MS: '400' })
  )
  try {
    await expect.poll(() => hookCall<number>(app, 'hook.checks')).toBeGreaterThanOrEqual(2)
    await openSettings(page, 'updates')
    await expect(page.locator('#auto-update-toggle')).toBeChecked()
    await expect(page.locator('#update-status')).toContainText('up to date · checked')
    await page.locator('#auto-update-toggle').uncheck()
    await expect.poll(() => readSettings(sandbox).autoUpdateCheck).toBe(false)
    await page.waitForTimeout(500)
    const settled = await hookCall<number>(app, 'hook.checks')
    await page.waitForTimeout(1500)
    expect(await hookCall<number>(app, 'hook.checks')).toBe(settled)

    await page.locator('#check-now').click()
    await expect.poll(() => hookCall<number>(app, 'hook.checks')).toBe(settled + 1)
    await page.locator('#auto-update-toggle').check()
    await expect.poll(() => readSettings(sandbox).autoUpdateCheck).toBe(true)
    await expect.poll(() => hookCall<number>(app, 'hook.checks')).toBeGreaterThan(settled + 1)
  } finally {
    await closeApp(app)
  }
})

test('a development build has no pill and Check now is disabled', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await expect(pill(page)).toBeHidden()
    await openSettings(page, 'updates')
    await expect(page.locator('#update-status')).toContainText('updates are off')
    await expect(page.locator('#check-now')).toBeDisabled()
  } finally {
    await closeApp(app)
  }
})

test('after an update the What is new dialog lists every version since the one you had, once', async () => {
  const sandbox = createSandbox()
  writeFileSync(
    join(sandbox.userData, 'settings.json'),
    JSON.stringify({ version: 2, projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }], lastSeenVersion: '0.2.0' }),
    'utf8'
  )
  const first = await launchApp(sandbox)
  const version = APP_VERSION
  try {
    const dialog = first.page.getByRole('dialog', { name: `What's new in Dawsha ${version}` })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Updated from 0.2.0')
    await expect(dialog.locator(`.wn-entry[data-version="${version}"]`)).toBeVisible()
    await expect(dialog.locator('.wn-entry[data-version="0.3.0"]')).toHaveCount(0)
    await expect(dialog.locator('.wn-entry[data-version="0.2.0"]')).toHaveCount(0)
    await dialog.locator('#wn-show-older').click()
    await expect(dialog.locator('.wn-entry[data-version="0.3.0"]')).toBeVisible()
    await expect(dialog.locator('#wn-show-older')).toHaveCount(0)
    await first.page.screenshot({ path: 'test-results/screens/32-whats-new.png' })
    expect(readSettings(sandbox).lastSeenVersion).toBe('0.2.0')
    await dialog.locator('#wn-close').click()
    await expect(first.page.locator('.whats-new')).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox).lastSeenVersion).toBe(version)
  } finally {
    await closeApp(first.app)
  }

  const second = await launchApp(sandbox)
  try {
    await expect(second.page.locator('.whats-new')).toHaveCount(0)
    await openSettings(second.page, 'changelog')
    await second.page.locator('#whats-new').click()
    const reopened = second.page.getByRole('dialog', { name: `What's new in Dawsha ${version}` })
    await expect(reopened).toBeVisible()
    await expect(reopened).not.toContainText('Updated from')
    await second.page.keyboard.press('Escape')
    await expect(second.page.locator('.whats-new')).toHaveCount(0)
  } finally {
    await closeApp(second.app)
  }
})

test('a fresh install records the version and shows setup instead of What is new', async () => {
  const sandbox = createSandbox({ empty: true })
  const { app, page } = await launchApp(sandbox)
  try {
    const version = APP_VERSION
    await expect(page.getByRole('dialog', { name: 'Set up Dawsha' })).toBeVisible()
    await expect(page.locator('.whats-new')).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox).lastSeenVersion).toBe(version)
  } finally {
    await closeApp(app)
  }
})

test('an install from 0.3.0 without a recorded version is treated as updated from 0.3.0', async () => {
  const sandbox = createSandbox()
  const { lastSeenVersion: _dropped, ...legacy } = readSettings(sandbox)
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify(legacy), 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    const dialog = page.getByRole('dialog', { name: `What's new in Dawsha ${APP_VERSION}` })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Updated from 0.3.0')
    await dialog.getByRole('button', { name: 'Got it' }).click()
    await expect.poll(() => readSettings(sandbox).lastSeenVersion).toBe(APP_VERSION)
  } finally {
    await closeApp(app)
  }
})
