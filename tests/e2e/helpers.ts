import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'

export interface Sandbox {
  root: string
  userData: string
  projectFolder: string
  sessionsDir: string
  codexHome: string
  geminiHome: string
  claudeHome: string
  openLog: string
  opsDir: string
  notifyLog: string
  quitLog: string
  pipe: string
}

export const APP_VERSION = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')).version as string

interface GridHook {
  bufferText(id: string): string
  lastInput(id: string): string
  fontSize(id: string): number
  feed(id: string, data: string): void
  selectAll(id: string): void
}

export function createSandbox(options: { empty?: boolean } = {}): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-e2e-'))
  const userData = join(root, 'userData')
  const projectFolder = join(root, 'Smoke Project')
  const sessionsDir = join(root, 'sessions')
  const codexHome = join(root, 'codex-home')
  const geminiHome = join(root, 'gemini-home')
  const claudeHome = join(root, 'claude-home')
  for (const dir of [userData, projectFolder, sessionsDir, codexHome, geminiHome, claudeHome]) mkdirSync(dir, { recursive: true })
  const settings = {
    version: 2,
    lastSeenVersion: APP_VERSION,
    projects: [
      { id: 'smoke', name: 'Smoke', folder: projectFolder },
      { id: 'gone', name: 'Missing', folder: join(root, 'does-not-exist') }
    ]
  }
  if (!options.empty) writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings), 'utf8')
  return {
    root,
    userData,
    projectFolder,
    sessionsDir,
    codexHome,
    geminiHome,
    claudeHome,
    openLog: join(root, 'open.log'),
    opsDir: join(root, 'ops'),
    notifyLog: join(root, 'notify.log'),
    quitLog: join(root, 'quit.log'),
    pipe: String.raw`\\.\pipe\dawsha-e2e-${process.pid}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  }
}

export async function launchApp(
  sandbox: Sandbox,
  extraEnv: Record<string, string> = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const env = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js')],
    env: {
      ...env,
      DAWSHA_USER_DATA: sandbox.userData,
      DAWSHA_APP_VERSION: APP_VERSION,
      DAWSHA_CLAUDE_COMMAND: 'cmd.exe',
      DAWSHA_CODEX_COMMAND: 'cmd.exe',
      DAWSHA_CODEX_HOME: sandbox.codexHome,
      DAWSHA_GEMINI_COMMAND: 'cmd.exe',
      DAWSHA_GEMINI_HOME: sandbox.geminiHome,
      DAWSHA_SHELL: 'cmd.exe',
      DAWSHA_SESSIONS_DIR: sandbox.sessionsDir,
      DAWSHA_CLAUDE_HOME: sandbox.claudeHome,
      DAWSHA_PANEON_USER_DATA: join(sandbox.root, 'Paneon'),
      DAWSHA_OPS_DIR: sandbox.opsDir,
      DAWSHA_OPEN_LOG: sandbox.openLog,
      DAWSHA_NOTIFY_LOG: sandbox.notifyLog,
      DAWSHA_QUIT_LOG: sandbox.quitLog,
      DAWSHA_PIPE: sandbox.pipe,
      GCM_INTERACTIVE: 'never',
      GIT_AUTHOR_NAME: 'Test User',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      ...extraEnv
    }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('html[data-ready="true"]', { timeout: 30_000 })
  return { app, page }
}

export async function activeTermId(page: Page): Promise<string> {
  const id = await page.locator('.term-host.active').first().getAttribute('data-term-id')
  if (!id) throw new Error('No active terminal')
  return id
}

export const bufferText = (page: Page, id: string): Promise<string> =>
  page.evaluate((termId) => (window as unknown as { __grid: GridHook }).__grid.bufferText(termId), id)

export const lastInput = (page: Page, id: string): Promise<string> =>
  page.evaluate((termId) => (window as unknown as { __grid: GridHook }).__grid.lastInput(termId), id)

export const feedTerminal = (page: Page, id: string, data: string): Promise<void> =>
  page.evaluate(([termId, text]) => (window as unknown as { __grid: GridHook }).__grid.feed(termId, text), [id, data])

export const selectAllText = (page: Page, id: string): Promise<void> =>
  page.evaluate((termId) => (window as unknown as { __grid: GridHook }).__grid.selectAll(termId), id)

export const fontSize = (page: Page, id: string): Promise<number> =>
  page.evaluate((termId) => (window as unknown as { __grid: GridHook }).__grid.fontSize(termId), id)

export const QUIT_BUDGET_MS = 10_000

function killTree(proc: ReturnType<ElectronApplication['process']>, reason: string): void {
  if (proc.exitCode !== null || proc.signalCode !== null || proc.pid === undefined) return
  console.warn(`[e2e] ${reason}: killing the app process tree (pid ${proc.pid})`)
  spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
}

export async function closeApp(app: ElectronApplication): Promise<number> {
  const started = Date.now()
  let proc: ReturnType<ElectronApplication['process']>
  try {
    proc = app.process()
  } catch {
    return 0
  }
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()))
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, QUIT_BUDGET_MS))])
  const elapsed = Date.now() - started
  killTree(proc, 'quit took longer than the budget')
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 5_000))])
  return elapsed
}

export async function closeBounded(app: ElectronApplication): Promise<void> {
  const proc = app.process()
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 20_000))])
  killTree(proc, 'close took longer than 20 s')
}

export interface CliResult {
  code: number | null
  out: string
  err: string
}

export function runCli(sandbox: Sandbox, args: string[], cwd: string = sandbox.root): Promise<CliResult> {
  const electronPath = require('electron') as unknown as string
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DAWSHA_PIPE: sandbox.pipe } as Record<string, string>
  return new Promise((resolveResult, reject) => {
    const child = spawn(electronPath, [resolve(__dirname, '../../build/dawsha-cli.cjs'), ...args], { cwd, env })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolveResult({ code, out: out.trim(), err: err.trim() }))
  })
}

export type SettingsSectionId = 'general' | 'notifications' | 'agents' | 'updates' | 'highlights' | 'changelog' | 'about' | 'remote'

export async function openSettings(page: Page, section: SettingsSectionId = 'general'): Promise<void> {
  const button = page.locator('#settings-button')
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(page.locator('.settings-view')).toBeVisible()
  await page.locator(`#settings-tab-${section}`).click()
  await expect(page.locator(`#settings-tab-${section}`)).toHaveAttribute('aria-selected', 'true')
}

export async function closeSettings(page: Page): Promise<void> {
  const button = page.locator('#settings-button')
  if ((await button.getAttribute('aria-pressed')) === 'true') await button.click()
  await expect(page.locator('.settings-view')).toBeHidden()
}
