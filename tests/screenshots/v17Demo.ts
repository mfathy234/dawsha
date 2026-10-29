import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { createSandbox, feedTerminal, launchApp } from '../e2e/helpers'
import { PROJECTS, demoEnv, folder, resize, seed, writeClaudeSession, writeCodex, writeGemini, writeOps } from './harness'
import { writeActiveTranscript } from './v1Fixtures'
import { makeAcmeWeb, makeRepo } from './v17Fixtures'

export const SITE = process.env.DAWSHA_SHOTS_OUT ?? resolve(__dirname, '../../site/assets')
const PERMISSION = ['  npm run migrate -- --env dev', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')
export const RECAPS = [
  'Toggle is wired into Settings; needs the migration approved.',
  'Export split into three steps; all 41 tests pass.',
  'Login test now waits for ready; 2 profile tests remain.',
  'Guide rewritten for the new installer; screenshots to add.'
]

export const termIdOfPane = async (page: Page, index: number): Promise<string> => {
  const id = await page.locator('.pane').nth(index).locator('.term-host').first().getAttribute('data-term-id')
  if (!id) throw new Error('No terminal in the pane')
  return id
}

export async function askPermission(page: Page, index: number): Promise<void> {
  const id = await termIdOfPane(page, index)
  const pane = page.locator('.pane').nth(index)
  await expect(async () => {
    await feedTerminal(page, id, `\r\n${PERMISSION}`)
    await expect(pane).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
  }).toPass({ timeout: 30_000 })
}

export function seedRepos(): void {
  for (const project of PROJECTS) rmSync(folder(project.name), { recursive: true, force: true })
  makeAcmeWeb(folder('acme-web'))
  makeRepo(folder('billing-api'), 'billing-api', 'fix/invoice-rounding', { 'src/export/invoices.ts': 'export function exportInvoices() {}\n' })
  makeRepo(folder('mobile-shell'), 'mobile-shell', 'review/login-tests', { 'tests/login.spec.ts': "import { test } from 'vitest'\n" })
  makeRepo(folder('docs-site'), 'docs-site', 'docs/getting-started', { 'docs/getting-started.md': '# Getting started\n' })
}

export async function launchDemo(settingsPatch: Record<string, unknown>, options: { panes?: boolean } = {}) {
  const sandbox = createSandbox()
  seed(sandbox, true)
  seedRepos()
  const settingsPath = join(sandbox.userData, 'settings.json')
  const stored = JSON.parse(readFileSync(settingsPath, 'utf8'))
  writeFileSync(settingsPath, JSON.stringify({ ...stored, onboardingDismissed: true, recordings: { enabled: false, keepDays: 14, maxMegabytes: 1024 }, ...settingsPatch }), 'utf8')
  writeActiveTranscript(sandbox, folder('acme-web'))
  const launched = await launchApp(sandbox, { ...demoEnv(), DAWSHA_SHARED_HOME: join(sandbox.root, 'shared-home') })
  await resize(launched.app)
  const { page } = launched
  await page.emulateMedia({ reducedMotion: 'reduce' })
  if (options.panes === false) return { ...launched, sandbox }
  for (const project of PROJECTS) {
    const agent = project.defaultAgent[0].toUpperCase() + project.defaultAgent.slice(1)
    await page.getByRole('button', { name: `New ${agent} session in ${project.name}`, exact: true }).click()
  }
  await expect(page.locator('.pane')).toHaveCount(4)
  writeClaudeSession(sandbox, 'acme-web', 'Add dark mode toggle', 'busy')
  writeClaudeSession(sandbox, 'billing-api', 'Refactor invoice export', 'idle')
  writeOps(sandbox)
  writeCodex(sandbox)
  await writeGemini(sandbox, page)
  for (const title of ['Add dark mode toggle', 'Refactor invoice export', 'Fix flaky login test', 'Rewrite the getting started guide']) {
    await expect(page.locator('.pane-title', { hasText: title })).toHaveCount(1, { timeout: 20_000 })
  }
  return { ...launched, sandbox }
}
