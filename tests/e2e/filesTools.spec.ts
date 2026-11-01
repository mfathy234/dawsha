import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const PAGE = '<!doctype html><title>Local fixture</title><h1>Hello from the fixture</h1><script>console.error("fixture broke on purpose")</script>'

test('the Browser tab opens a local page in a locked-down native view, refuses other schemes, steps aside for dialogs and closes cleanly', async () => {
  test.setTimeout(120_000)
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end(PAGE)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as AddressInfo).port
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  const pages = () => app.evaluate(({ webContents, session }) => webContents.getAllWebContents().filter((w) => w.getURL().startsWith('http://127.0.0.1')).map((w) => ({
    url: w.getURL(), prefs: (w as unknown as { getLastWebPreferences(): Record<string, unknown> }).getLastWebPreferences(), title: w.getTitle(), ownSession: w.session === session.fromPartition('dawsha-browser') && w.session !== session.defaultSession
  })))
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await page.locator('#files-run-toggle').click()
    await page.locator('#files-ptab-browser').click()
    await expect(page.locator('#files-browser-hint')).toBeVisible()

    await page.locator('#files-browser-address').fill('file:///C:/Windows/win.ini')
    await page.locator('#files-browser-address').press('Enter')
    await expect(page.locator('#files-browser-problem')).toContainText('Only http and https')
    expect(await pages()).toHaveLength(0)

    await page.locator('#files-browser-address').fill(`127.0.0.1:${port}`)
    await page.locator('#files-browser-address').press('Enter')
    await expect.poll(async () => (await pages()).length).toBe(1)
    const [opened] = await pages()
    expect(opened.url).toBe(`http://127.0.0.1:${port}/`)
    expect(opened.prefs.sandbox).toBe(true)
    expect(opened.prefs.contextIsolation).toBe(true)
    expect(opened.prefs.nodeIntegration).toBe(false)
    expect(opened.prefs.preload).toBeUndefined()
    expect(opened.ownSession).toBe(true)
    expect(opened.title).toBe('Local fixture')
    await expect(page.locator('#files-browser-address')).toHaveValue(`http://127.0.0.1:${port}/`)
    await expect(page.locator('#files-browser-errors')).toContainText('Send 1 error')
    await expect(page.locator('#files-browser-stage')).toHaveAttribute('data-covered', 'false')
    await page.screenshot({ path: 'test-results/screens/191-files-browser.png' })

    await page.evaluate(() => {
      const cover = document.createElement('div')
      cover.id = 'test-cover'
      cover.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.4)'
      document.body.append(cover)
    })
    await expect(page.locator('#files-browser-stage')).toHaveAttribute('data-covered', 'true')
    await page.evaluate(() => document.getElementById('test-cover')?.remove())
    await expect(page.locator('#files-browser-stage')).toHaveAttribute('data-covered', 'false')

    await page.locator('#files-ptab-problems').click()
    await expect(page.locator('#files-browser')).toBeHidden()
    expect(await pages()).toHaveLength(1)
    await page.locator('#files-ptab-browser').click()
    await page.locator('#files-browser-close').click()
    await expect.poll(async () => (await pages()).length).toBe(0)
    await expect(page.locator('#files-browser-hint')).toBeVisible()
  } finally {
    await closeApp(app)
    server.close()
  }
})

test('the Pull request tab explains a missing gh, then opens a PR, lists feedback and merges only after a confirmation that names it', async () => {
  test.setTimeout(150_000)
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  mkdirSync(join(root, 'app'), { recursive: true })
  writeFileSync(join(root, 'app', 'settings.txt'), 'x')
  git('add', '.')
  git('commit', '-qm', 'initial')
  git('switch', '-qc', 'feature/config')
  git('remote', 'add', 'origin', 'https://example.invalid/o/r.git')

  const missing = await launchApp(sandbox, { DAWSHA_GH_COMMAND: join(sandbox.root, 'no-such-gh') })
  try {
    await missing.page.setViewportSize({ width: 1024, height: 728 })
    await missing.page.locator('#files-button').click()
    await missing.page.locator('#files-run-toggle').click()
    await missing.page.locator('#files-ptab-pr').click()
    await expect(missing.page.locator('#files-pr-state')).toHaveAttribute('data-reason', 'gh-missing')
    await expect(missing.page.locator('#files-pr-message')).toContainText('not installed')
  } finally {
    await closeApp(missing.app)
  }

  const state = mkdtempSync(join(tmpdir(), 'dawsha-fake-gh-'))
  const { app, page } = await launchApp(sandbox, { DAWSHA_GH_SCRIPT: resolve(__dirname, '../support/fakeGh.cjs'), FAKE_GH_DIR: state })
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#files-button').click()
    await page.locator('#files-run-toggle').click()
    await page.locator('#files-ptab-pr').click()
    await expect(page.locator('#files-pr-title')).toHaveValue('Config')
    await page.locator('#files-pr-title').fill('Add config tab')
    await page.locator('#files-pr-create').click()
    await expect(page.locator('#files-pr-link')).toHaveText('#7 Add config tab')
    await expect(page.locator('#files-pr-checks')).toContainText('1 failing')
    await expect(page.locator('#files-pr-checks')).toContainText('CI / build')
    await expect(page.locator('#files-pr-comments')).toContainText('Rename this setting')
    await expect(page.locator('#files-pr-comments')).toContainText('Please add tests')
    const created = readFileSync(join(state, 'calls.log'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[])
    expect(created.find((call) => call[1] === 'create')).toEqual(['pr', 'create', '--title=Add config tab', '--body=', ])
    await page.screenshot({ path: 'test-results/screens/192-files-pr.png' })

    await page.locator('#files-pr-merge').click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('#7 Add config tab')
    await expect(dialog.getByRole('button', { name: 'Merge #7 Add config tab' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(readFileSync(join(state, 'calls.log'), 'utf8')).not.toContain('"merge"')

    await page.locator('#files-pr-merge').click()
    await page.getByRole('button', { name: 'Merge #7 Add config tab' }).click()
    await expect.poll(() => readFileSync(join(state, 'calls.log'), 'utf8')).toContain('"merge"')
    const calls = readFileSync(join(state, 'calls.log'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[])
    expect(calls.find((call) => call[1] === 'merge')).toEqual(['pr', 'merge', '7', '--squash', `--match-head-commit=${'b'.repeat(40)}`])
    await expect(page.locator('#files-pr-status')).toContainText('Merged')
  } finally {
    await closeApp(app)
  }
})
