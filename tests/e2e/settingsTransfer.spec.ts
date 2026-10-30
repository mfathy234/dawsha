import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp, openSettings, QUIT_BUDGET_MS, type Sandbox } from './helpers'

const SECRET_EMAIL = 'private-person@example.com'
const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

function seedSource(sandbox: Sandbox): void {
  const path = join(sandbox.userData, 'settings.json')
  const stored = JSON.parse(readFileSync(path, 'utf8'))
  const next = {
    ...stored,
    lastSeenVersion: APP_VERSION,
    sessionsLayout: 'board',
    snippets: [{ id: 'sn1', name: 'Legacy', text: 'Kept in old exports.', projectId: null, shortcut: null }],
    layouts: [
      {
        id: 'l1',
        name: 'Morning',
        createdAt: 1,
        focusedIndex: 0,
        panes: [{ projectId: 'smoke', activeIndex: 0, fontSize: 15, tabs: [{ agent: 'claude', label: 'claude' }] }]
      }
    ],
    remoteAccess: { allowedEmail: SECRET_EMAIL, terminalInput: true, sessionControl: true, approvals: true }
  }
  writeFileSync(path, JSON.stringify(next), 'utf8')
}

test('exports settings without remote access data and imports them into a fresh install with merge or replace', async () => {
  const source = createSandbox()
  seedSource(source)
  const file = join(source.root, 'dawsha-settings-test.json')
  const first = await launchApp(source, { DAWSHA_SAVE_PATH: file })
  try {
    await openSettings(first.page, 'import')
    await first.page.locator('#export-settings').click()
    await expect(first.page.locator('.toast').last()).toContainText('Settings saved to', { timeout: 20_000 })
  } finally {
    expect(await closeApp(first.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
  const text = readFileSync(file, 'utf8')
  const envelope = JSON.parse(text)
  expect(envelope).toMatchObject({ app: 'dawsha', kind: 'settings-export', version: 1, appVersion: APP_VERSION })
  expect(envelope.data.projects.map((p: { name: string }) => p.name)).toEqual(['Smoke', 'Missing'])
  expect(envelope.data.snippets).toBeUndefined()
  expect(envelope.data.layouts).toHaveLength(1)
  expect(envelope.data.sessionsLayout).toBe('board')
  expect(envelope.data.remoteAccess).toBeUndefined()
  expect(text).not.toContain(SECRET_EMAIL)
  expect(text).not.toContain('terminalInput')

  const target = createSandbox()
  const second = await launchApp(target, { DAWSHA_OPEN_PATH: file })
  const { page } = second
  try {
    await openSettings(page, 'import')
    await page.locator('#import-settings').click()
    const dialog = page.getByRole('dialog', { name: 'Import settings' })
    await expect(dialog).toContainText('2 projects (2 new, 0 already here)')
    await expect(dialog).toContainText('1 folder not found on this PC')
    await expect(dialog.getByLabel('Merge')).toBeChecked()
    await dialog.getByRole('button', { name: 'Import' }).click()
    await expect(page.locator('.toast').last()).toContainText('Imported 2 projects, 1 layout')
    await expect.poll(() => readSettings(target.userData).projects.length).toBe(4)
    const merged = readSettings(target.userData)
    expect(merged.snippets).toBeUndefined()
    expect(merged.layouts.map((l: { name: string }) => l.name)).toEqual(['Morning'])
    expect(merged.sessionsLayout).toBe('board')
    expect(merged.remoteAccess?.allowedEmail ?? '').toBe('')

    await openSettings(page, 'import')
    await page.locator('#import-settings').click()
    const again = page.getByRole('dialog', { name: 'Import settings' })
    await expect(again).toContainText('2 projects (0 new, 2 already here)')
    await again.getByLabel('Replace').check()
    await again.getByRole('button', { name: 'Import' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Replace your projects and layouts?' })
    await expect(confirm).toContainText('Smoke')
    await expect(confirm).toContainText('Missing')
    await expect(confirm.getByRole('button', { name: 'Replace and remove 2 projects, 1 layout' })).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    expect(readSettings(target.userData).projects).toHaveLength(4)

    await page.locator('#import-settings').click()
    const last = page.getByRole('dialog', { name: 'Import settings' })
    await last.getByLabel('Replace').check()
    await last.getByRole('button', { name: 'Import' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: /^Replace/ }).click()
    await expect.poll(() => readSettings(target.userData).projects.length).toBe(2)
    await expect(page.locator('.toast').last()).toContainText('Imported')
  } finally {
    expect(await closeApp(second.app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('importing a file that is not a Dawsha settings export changes nothing and says why', async () => {
  const sandbox = createSandbox()
  const bad = join(sandbox.root, 'bad.json')
  writeFileSync(bad, JSON.stringify({ app: 'dawsha', kind: 'settings-export', version: 9, data: {} }), 'utf8')
  const { app, page } = await launchApp(sandbox, { DAWSHA_OPEN_PATH: bad })
  try {
    const before = readSettings(sandbox.userData).projects.length
    await openSettings(page, 'import')
    await page.locator('#import-settings').click()
    await expect(page.locator('.toast').last()).toContainText('version 9')
    await expect(page.getByRole('dialog', { name: 'Import settings' })).toHaveCount(0)
    expect(readSettings(sandbox.userData).projects).toHaveLength(before)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
