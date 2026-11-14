import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openMore } from './helpers'

test('local files are suggested once and setup choices survive reopening', async () => {
  const sandbox = createSandbox()
  execFileSync('git', ['init', '-q'], { cwd: sandbox.projectFolder })
  writeFileSync(join(sandbox.projectFolder, '.gitignore'), '.env\nappsettings.user.json\n*.pem\n.env.example\n')
  for (const name of ['.env', 'appsettings.user.json', 'private.pem', '.env.example']) writeFileSync(join(sandbox.projectFolder, name), 'local')
  writeFileSync(join(sandbox.projectFolder, 'package-lock.json'), '{}')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#new-session').click()
    const pick = page.getByRole('dialog', { name: 'New session', exact: true })
    await expect(pick.getByRole('region', { name: 'Worktree setup suggestion' })).toContainText('Copy 2 local files into new worktrees?')
    await expect(pick.getByRole('region', { name: 'Worktree setup suggestion' })).not.toContainText('private.pem')
    await pick.getByRole('button', { name: 'Save as .worktreeinclude', exact: true }).click()
    await expect.poll(() => readFileSync(join(sandbox.projectFolder, '.worktreeinclude'), 'utf8')).toContain('.env')
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).projects?.[0]?.worktreeSetup?.prompted).toBe(true)
    await pick.getByRole('button', { name: 'Worktree setup…', exact: true }).click()
    const setup = page.getByRole('dialog', { name: 'Worktree setup for Smoke', exact: true })
    await setup.getByRole('button', { name: /npm ci/ }).click()
    await expect(setup.getByLabel('Setup command', { exact: true })).toHaveValue('npm ci')
    await setup.getByLabel('Setup command', { exact: true }).fill('echo ready')
    await setup.getByRole('button', { name: 'Save setup', exact: true }).click()
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).projects?.[0]?.worktreeSetup?.command).toBe('echo ready')
    await page.locator('#new-session').click()
    await expect(page.getByRole('region', { name: 'Worktree setup suggestion' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Worktree setup…', exact: true }).click()
    await expect(page.getByLabel('Setup command', { exact: true })).toHaveValue('echo ready')
    await page.getByLabel('Setup command', { exact: true }).fill('')
    await page.getByRole('button', { name: 'Save setup', exact: true }).click()
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).projects?.[0]?.worktreeSetup?.command).toBe('')
  } finally {
    await closeApp(app)
  }
})

test('Not now is remembered and worktree setup stays available from the project menu', async () => {
  const sandbox = createSandbox()
  execFileSync('git', ['init', '-q'], { cwd: sandbox.projectFolder })
  writeFileSync(join(sandbox.projectFolder, '.gitignore'), '.env\n')
  writeFileSync(join(sandbox.projectFolder, '.env'), 'LOCAL=1')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#new-session').click()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('checkbox', { name: 'Use its own worktree', exact: true })).toBeFocused()
    await page.keyboard.press('Space')
    await expect(page.getByRole('checkbox', { name: 'Use its own worktree', exact: true })).toBeChecked()
    await page.getByRole('region', { name: 'Worktree setup suggestion' }).getByRole('button', { name: 'Not now' }).click()
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).projects?.[0]?.worktreeSetup?.prompted).toBe(true)
    expect(existsSync(join(sandbox.projectFolder, '.worktreeinclude'))).toBe(false)
    await page.keyboard.press('Escape')
    await page.locator('#new-session').click()
    await expect(page.getByRole('region', { name: 'Worktree setup suggestion' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await openMore(page, 'projects')
    await page.getByRole('button', { name: 'More for Smoke', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Worktree setup…', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Worktree setup for Smoke', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Local files to copy', { exact: true })).toHaveValue('.env')
    await page.keyboard.press('Escape')
    expect(existsSync(join(sandbox.projectFolder, '.worktreeinclude'))).toBe(false)
  } finally {
    await closeApp(app)
  }
})
