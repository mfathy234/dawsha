import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'

export async function closePaneViaActions(pane: Locator): Promise<void> {
  await pane.getByRole('button', { name: 'Pane actions' }).click()
  await pane.getByRole('menuitem', { name: 'Close pane' }).click()
}

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

export async function openTerminalPicker(pane: Locator): Promise<void> {
  await pane.getByRole('button', { name: 'Pane actions' }).click()
  await pane.getByRole('menuitem', { name: 'New terminal', exact: true }).click()
}

export const APP_VERSION = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')).version as string

// Playwright disposes its server-side app object on exit; process() is unsafe after that.
interface AppProcess {
  proc: ReturnType<ElectronApplication['process']>
  mainPid: number | null
}
const appProcesses = new WeakMap<ElectronApplication, AppProcess>()

interface GridHook {
  bufferText(id: string): string
  rawBufferText(id: string): string
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
    pipe: process.platform === 'win32'
      ? String.raw`\\.\pipe\dawsha-e2e-${process.pid}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      : join(tmpdir(), `dawsha-e2e-${process.pid}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.sock`)
  }
}

export async function launchApp(
  sandbox: Sandbox,
  extraEnv: Record<string, string> = {},
  chromiumArgs: string[] = []
): Promise<{ app: ElectronApplication; page: Page }> {
  const env = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js'), ...chromiumArgs],
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
      DAWSHA_OPS_DIR: sandbox.opsDir,
      DAWSHA_OPEN_LOG: sandbox.openLog,
      DAWSHA_NOTIFY_LOG: sandbox.notifyLog,
      DAWSHA_QUIT_LOG: sandbox.quitLog,
      DAWSHA_PIPE: sandbox.pipe,
      // Off-screen window: test runs do not pop up on the desktop. Set DAWSHA_OFFSCREEN=0 to watch a run.
      DAWSHA_OFFSCREEN: process.env.DAWSHA_OFFSCREEN ?? '1',
      GCM_INTERACTIVE: 'never',
      GIT_AUTHOR_NAME: 'Test User',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      ...extraEnv
    }
  })
  const proc = app.process()
  const tracked: AppProcess = { proc, mainPid: null }
  appProcesses.set(app, tracked)
  // Playwright waits for ChildProcess 'close', not 'exit'. Detached descendants can
  // inherit these pipes and prevent close forever, even after Electron has exited.
  const releasePipes = (): void => { for (const pipe of proc.stdio) pipe?.destroy() }
  proc.once('exit', releasePipes)
  if (proc.exitCode !== null || proc.signalCode !== null) releasePipes()
  try {
    tracked.mainPid = await app.evaluate(() => process.pid)
    const page = await app.firstWindow()
    await page.waitForSelector('html[data-ready="true"]', { timeout: 30_000 })
    return { app, page }
  } catch (error) {
    await closeBounded(app)
    throw error
  }
}

export async function activeTermId(page: Page): Promise<string> {
  const id = await page.locator('.term-host.active').first().getAttribute('data-term-id')
  if (!id) throw new Error('No active terminal')
  return id
}

export const bufferText = (page: Page, id: string): Promise<string> =>
  page.evaluate((termId) => (window as unknown as { __grid: GridHook }).__grid.bufferText(termId), id)

/** The buffer as the program wrote it; bufferText puts Claude Code's visual-order Arabic back in reading order. */
export const rawBufferText = (page: Page, id: string): Promise<string> =>
  page.evaluate((termId) => (window as unknown as { __grid: GridHook }).__grid.rawBufferText(termId), id)

export const lastInput = (page: Page, id: string): Promise<string> =>
  page.evaluate((termId) => (window as unknown as { __grid: GridHook }).__grid.lastInput(termId), id)

export const feedTerminal = (page: Page, id: string, data: string): Promise<void> =>
  page.evaluate(([termId, text]) => (window as unknown as { __grid: GridHook }).__grid.feed(termId, text), [id, data])

export const selectAllText = (page: Page, id: string): Promise<void> =>
  page.evaluate((termId) => (window as unknown as { __grid: GridHook }).__grid.selectAll(termId), id)

export const fontSize = (page: Page, id: string): Promise<number> =>
  page.evaluate((termId) => (window as unknown as { __grid: GridHook }).__grid.fontSize(termId), id)

export const QUIT_BUDGET_MS = 10_000

async function killTree(proc: ReturnType<ElectronApplication['process']>, reason: string): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null || proc.pid === undefined) return
  console.warn(`[e2e] ${reason}: killing the app process tree (pid ${proc.pid})`)
  await new Promise<void>((resolve) => {
    execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 1000 }, () => {
      // Tree enumeration itself can stall on Windows. The tracked launcher must
      // still exit so its inherited pipes and Playwright connection can close.
      if (proc.exitCode === null && proc.signalCode === null) proc.kill()
      resolve()
    })
  })
}

function reclaimLauncher(tracked: AppProcess): boolean {
  if (tracked.mainPid === null || tracked.mainPid === tracked.proc.pid) return false
  if (tracked.proc.exitCode !== null || tracked.proc.signalCode !== null) return false
  // On Windows Playwright launches through cmd.exe. Its close RPC can still be
  // waiting on that shell after the real Electron process is gone, even if the
  // browser context never emitted close. Only reclaim it while closing the app.
  try { process.kill(tracked.mainPid, 0); return false } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false
  }
  void killTree(tracked.proc, 'Electron exited but its launcher is still running')
  return true
}

async function waitForCleanup(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms) })])
  } finally {
    clearTimeout(timer)
  }
}

export async function closeApp(app: ElectronApplication): Promise<number> {
  const started = Date.now()
  const tracked = appProcesses.get(app)
  let proc = tracked?.proc
  try {
    proc ??= app.process()
  } catch {
    // The app has already exited. Still dispose its Playwright context below.
  }
  // Let Playwright close its debugger connection as it requests quit, before Electron exits.
  const reaper = tracked && process.platform === 'win32' ? setInterval(() => {
    if (reclaimLauncher(tracked)) clearInterval(reaper)
  }, 50) : undefined
  reaper?.unref()
  try {
    const closed = app.close().catch(() => undefined)
    await waitForCleanup(closed, QUIT_BUDGET_MS)
    const elapsed = Date.now() - started
    if (proc) await killTree(proc, 'quit took longer than the budget')
    await waitForCleanup(closed, 5_000)
    return elapsed
  } finally {
    clearInterval(reaper)
  }
}

export async function closeBounded(app: ElectronApplication): Promise<void> {
  await closeApp(app)
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

export type SettingsSectionId = 'general' | 'appearance' | 'notifications' | 'agents' | 'import' | 'updates' | 'highlights' | 'changelog' | 'about' | 'remote'

export async function openSettings(page: Page, section: SettingsSectionId = 'general'): Promise<void> {
  const button = page.locator('#settings-button')
  const tab = section === 'highlights' ? 'notifications' : section === 'changelog' ? 'about' : section
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(page.locator('.settings-view')).toBeVisible()
  await page.locator(`#settings-tab-${tab}`).click()
  await expect(page.locator(`#settings-tab-${tab}`)).toHaveAttribute('aria-selected', 'true')
}

export async function closeSettings(page: Page): Promise<void> {
  const button = page.locator('#settings-button')
  if ((await button.getAttribute('aria-pressed')) === 'true') await button.click()
  await expect(page.locator('.settings-view')).toBeHidden()
}

export type MoreMenuView = 'projects' | 'usage' | 'work' | 'agents' | 'skills' | 'layouts'

/** Leaves an agent's page for the Agents roster (the breadcrumb). */
export async function backToAgents(page: Page): Promise<void> {
  await page.locator('.crew-crumb-link').click()
  await expect(page.locator('.crew-roster')).toBeVisible()
}

/** Opens a view that lives under the top bar's More menu (Projects, Usage, Work, Agent tools, Skills, Layouts). */
export async function openMore(page: Page, view: MoreMenuView): Promise<void> {
  if (view === 'skills' || view === 'work') {
    const button = page.locator(`#${view}-button`)
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
    return
  }
  await page.locator('#more-button').click()
  await page.locator(`#${view}-menu-item`).click()
}

/** A project without open sessions starts as a one-line row; this opens it the way a click does, so its closed sessions show. */
export async function openQuietProject(page: Page, name = 'Smoke'): Promise<void> {
  const toggle = page.locator('.proj-row.quiet-row', { hasText: name }).locator('.quiet-toggle')
  if ((await toggle.count()) > 0) await toggle.click()
}
