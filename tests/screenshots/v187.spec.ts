import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, launchApp, openSettings, type Sandbox } from '../e2e/helpers'

// Dawsha 1.8.7 screenshots: Desktop app style, Side panel, Mini window and Appearance settings.
const SITE = process.env.DAWSHA_SHOTS_OUT ?? resolve(__dirname, '../../site/assets')
const AGENT = resolve(__dirname, '../support/chatAgent.cjs')
const WINDOW = { width: 1440, height: 900 }
// reply-summary.png is 1168x668; app shots are cropped to the top 1440x824 and resized to that size.
const OUTPUT = { width: 1168, height: 668 }
const CROP = { x: 0, y: 0, width: 1440, height: 824 }

const ACME = 'acme-web'
const BILLING = 'billing-api'
const COMMAND = 'npm test -- ThemeToggle'

const SESSIONS = {
  darkMode: '6e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
  invoiceExport: '7f2a3b4c-5d6e-4f70-9b0c-1d2e3f4a5b6c',
  loginTest: '8a3b4c5d-6e7f-4071-8c1d-2e3f4a5b6c7d',
  invoiceCsv: '9b4c5d6e-7f80-4172-9d2e-3f4a5b6c7d8e'
} as const

const line = (record: unknown): string => JSON.stringify(record) + '\n'
const iso = (offsetMs = 0): string => new Date(Date.now() + offsetMs).toISOString()
const slug = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-')
const transcript = (sandbox: Sandbox, cwd: string, id: string): string => join(sandbox.claudeHome, 'projects', slug(cwd), `${id}.jsonl`)
const billingFolder = (sandbox: Sandbox): string => join(sandbox.root, BILLING)

function git(folder: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd: folder, encoding: 'utf8' })
}

/** Two fake projects only; the sandbox's own Smoke and Missing projects are replaced. */
function seedSettings(sandbox: Sandbox, patch: Record<string, unknown>): void {
  mkdirSync(billingFolder(sandbox), { recursive: true })
  const file = join(sandbox.userData, 'settings.json')
  const stored = JSON.parse(readFileSync(file, 'utf8'))
  const projects = [
    { id: ACME, name: ACME, defaultAgent: 'claude', folder: sandbox.projectFolder },
    { id: BILLING, name: BILLING, defaultAgent: 'claude', folder: billingFolder(sandbox) }
  ]
  const recordings = { enabled: false, keepDays: 14, maxMegabytes: 1024 }
  writeFileSync(file, JSON.stringify({ ...stored, onboardingDismissed: true, recordings, projects, ...patch }), 'utf8')
}

function writeSession(sandbox: Sandbox, id: string, cwd: string, name: string, status: 'busy' | 'idle'): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${id}.json`),
    JSON.stringify({ pid: process.pid, sessionId: id, cwd, name, nameSource: 'user', status, startedAt: now + 1000, updatedAt: now + 1000 }),
    'utf8'
  )
}

function writeTodos(sandbox: Sandbox, id: string, cwd: string, completed: number): void {
  const names = ['Read the toggle component', 'Persist the choice in localStorage', 'Add the unit tests']
  const todos = names.map((content, index) => ({
    content,
    status: index < completed ? 'completed' : index === completed ? 'in_progress' : 'pending',
    activeForm: content
  }))
  mkdirSync(join(transcript(sandbox, cwd, id), '..'), { recursive: true })
  writeFileSync(
    transcript(sandbox, cwd, id),
    [
      { type: 'user', uuid: `u-${id}`, timestamp: iso(), message: { role: 'user', content: 'Add a dark mode toggle to settings' } },
      { type: 'assistant', uuid: `p-${id}`, message: { role: 'assistant', content: [{ type: 'tool_use', id: `tt-${id}`, name: 'TodoWrite', input: { todos } }] } },
      { type: 'user', uuid: `pr-${id}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tt-${id}`, content: 'ok' }] } }
    ].map(line).join(''),
    'utf8'
  )
}

function makeRepo(sandbox: Sandbox, id: string): void {
  const root = sandbox.projectFolder
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'settings.ts'), 'export const theme = "light"\nexport const panel = "general"\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'acme-web', private: true }))
  git(root, 'init', '-q', '-b', 'feat/dark-mode')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'base')
  git(root, 'update-ref', `refs/dawsha/checkpoints/${id}/${createHash('sha1').update('u1').digest('hex').slice(0, 16)}`, 'HEAD')
  writeFileSync(join(root, 'src', 'settings.ts'), 'export const theme = "system"\nexport const panel = "general"\n')
  writeFileSync(join(root, 'src', 'ThemeToggle.tsx'), 'export function ThemeToggle() {\n  return null\n}\n')
}

function writeChangeLog(sandbox: Sandbox, id: string): void {
  const todos = [
    { content: 'Read the settings module', status: 'completed', activeForm: 'Reading the settings module' },
    { content: 'Add the toggle', status: 'in_progress', activeForm: 'Adding the toggle' },
    { content: 'Run the tests', status: 'pending', activeForm: 'Running the tests' }
  ]
  mkdirSync(join(transcript(sandbox, sandbox.projectFolder, id), '..'), { recursive: true })
  writeFileSync(
    transcript(sandbox, sandbox.projectFolder, id),
    [
      { type: 'user', uuid: 'u1', timestamp: iso(), message: { role: 'user', content: 'Add a dark mode toggle to settings' } },
      { type: 'assistant', uuid: 'p1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tt', name: 'TodoWrite', input: { todos } }] } },
      { type: 'user', uuid: 'pr', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tt', content: 'ok' }] } },
      { type: 'assistant', uuid: 'e1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/settings.ts', old_string: 'theme = "light"', new_string: 'theme = "system"' } }] } },
      { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
      { type: 'assistant', uuid: 'e2', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Write', input: { file_path: 'src/ThemeToggle.tsx', content: 'export function ThemeToggle() {\n  return null\n}\n' } }] } },
      { type: 'user', uuid: 'r2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } },
      { type: 'assistant', uuid: 'a1', timestamp: iso(), message: { role: 'assistant', content: [{ type: 'text', text: 'The toggle is in place; the system theme is the default.' }] } }
    ].map(line).join(''),
    'utf8'
  )
}

const agentEnv = (log: string): Record<string, string> => ({ CHAT_LOG: log, DAWSHA_CLAUDE_COMMAND: process.execPath, DAWSHA_CLAUDE_ARGS: JSON.stringify([AGENT, 'claude']) })

async function addClaude(page: Page, project: string, count: number): Promise<void> {
  await page.getByRole('button', { name: `New Claude session in ${project}`, exact: true }).click()
  await expect(page.locator('.pane')).toHaveCount(count, { timeout: 20_000 })
}

const paneTitled = (page: Page, title: string): Locator => page.locator('.pane').filter({ has: page.locator('.pane-title', { hasText: title }) }).first()

/** Clears a pane's terminal and writes neutral shell output, so no Windows user path from the sandbox shows in the shot. */
async function tidyPane(page: Page, pane: Locator, lines: string[]): Promise<void> {
  const id = (await pane.locator('.term-host.active').getAttribute('data-term-id'))!
  await expect.poll(async () => (await bufferText(page, id)).replace(/\n/g, '').trimEnd(), { timeout: 30_000 }).toMatch(/[>$#%]$/)
  await feedTerminal(page, id, '\x1b[2J\x1b[H' + [...lines, '$ '].join('\r\n'))
}

/** Fake a permission prompt in the pane's shell, once its real prompt is up (same approach as sidebarRevamp.spec.ts). */
async function makeNeedsYou(page: Page, pane: Locator): Promise<void> {
  const id = (await pane.locator('.term-host.active').getAttribute('data-term-id'))!
  await expect.poll(async () => (await bufferText(page, id)).replace(/\n/g, '').trimEnd(), { timeout: 30_000 }).toMatch(/[>$#%]$/)
  await expect(async () => {
    await feedTerminal(page, id, ['● Bash(npm test -- ThemeToggle)', 'Do you want to proceed?', '1. Yes', '2. Yes, and don\'t ask again', '3. No, and tell Claude what to do differently', ''].join('\r\n'))
    await expect.poll(() => bufferText(page, id), { timeout: 1500 }).toContain('1. Yes')
    await expect(pane).toHaveAttribute('data-attention', 'needs', { timeout: 1500 })
  }).toPass({ timeout: 15_000 })
}

/** Writes a PNG of the app window, cropped and resized to the 1168x668 site size. Done in the main process with nativeImage. */
async function saveSized(app: ElectronApplication, page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.querySelectorAll('.proj-missing-line').forEach((node) => node.setAttribute('hidden', '')))
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: WINDOW.width, height: WINDOW.height } })
  const b64 = await app.evaluate(
    ({ nativeImage }, args: { data: string; crop: typeof CROP; out: typeof OUTPUT }) => {
      const image = nativeImage.createFromBuffer(Buffer.from(args.data, 'base64'))
      const cropped = image.crop(args.crop)
      return cropped.resize({ width: args.out.width, height: args.out.height, quality: 'best' }).toPNG().toString('base64')
    },
    { data: shot.toString('base64'), crop: CROP, out: OUTPUT }
  )
  mkdirSync(SITE, { recursive: true })
  writeFileSync(join(SITE, name), Buffer.from(b64, 'base64'))
}

async function setWindow(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Dawsha')!
    window.setContentSize(size.width, size.height)
  }, WINDOW)
  await page.setViewportSize(WINDOW)
  await page.waitForTimeout(400)
}

async function openMini(app: ElectronApplication, page: Page): Promise<Page> {
  const opened = app.waitForEvent('window')
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mini window' }).click()
  const mini = await opened
  await expect(mini.locator('#mini')).toBeVisible()
  return mini
}

test('Desktop app style: quiet panes, sidebar frame and warm tone with four sessions from two projects', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  seedSettings(sandbox, { appearance: { panes: 'quiet', frame: 'sidebar', tone: 'warm' } })
  writeTodos(sandbox, SESSIONS.darkMode, sandbox.projectFolder, 1)
  const { app, page } = await launchApp(sandbox)
  try {
    await setWindow(app, page)
    await addClaude(page, ACME, 1)
    await addClaude(page, BILLING, 2)
    await addClaude(page, ACME, 3)
    await addClaude(page, BILLING, 4)
    writeSession(sandbox, SESSIONS.darkMode, sandbox.projectFolder, 'Add dark mode toggle', 'busy')
    writeSession(sandbox, SESSIONS.invoiceExport, billingFolder(sandbox), 'Refactor invoice export', 'busy')
    writeSession(sandbox, SESSIONS.loginTest, sandbox.projectFolder, 'Fix flaky login test', 'idle')
    writeSession(sandbox, SESSIONS.invoiceCsv, billingFolder(sandbox), 'Add invoice CSV export', 'idle')
    for (const title of ['Add dark mode toggle', 'Refactor invoice export', 'Fix flaky login test', 'Add invoice CSV export']) {
      await expect(page.locator('.pane-title', { hasText: title })).toHaveCount(1, { timeout: 20_000 })
    }
    await tidyPane(page, paneTitled(page, 'Add dark mode toggle'), ['> Reading src/settings.ts', '> Adding the toggle'])
    await tidyPane(page, paneTitled(page, 'Refactor invoice export'), ['> Moving the CSV columns into a helper'])
    await tidyPane(page, paneTitled(page, 'Fix flaky login test'), ['> Waiting for the ready event'])
    await tidyPane(page, paneTitled(page, 'Add invoice CSV export'), ['> Writing the export test'])
    await makeNeedsYou(page, paneTitled(page, 'Add dark mode toggle'))
    await expect(page.getByRole('region', { name: 'Needs you' })).toBeVisible({ timeout: 20_000 })
    // Re-rendering a pane can replay the shell banner, so clear the needing pane again with neutral output; the attention state stays.
    const needsId = (await paneTitled(page, 'Add dark mode toggle').locator('.term-host.active').getAttribute('data-term-id'))!
    await feedTerminal(page, needsId, '\x1b[2J\x1b[H' + ['> Adding the toggle to the settings panel', '$ '].join('\r\n'))
    await expect(paneTitled(page, 'Add dark mode toggle')).toHaveAttribute('data-attention', 'needs')
    await page.waitForTimeout(1200)
    await page.mouse.move(WINDOW.width - 4, WINDOW.height - 4)
    await saveSized(app, page, 'desktop-style.png')
  } finally {
    await closeApp(app)
  }
})

test('Side panel: Changes tab lists the files the last reply changed, with several sessions in the tab strip', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  seedSettings(sandbox, { sessionsLayout: 'panel' })
  makeRepo(sandbox, SESSIONS.darkMode)
  writeChangeLog(sandbox, SESSIONS.darkMode)
  const env = agentEnv(transcript(sandbox, sandbox.projectFolder, SESSIONS.darkMode))
  const { app, page } = await launchApp(sandbox, env)
  try {
    await setWindow(app, page)
    await addClaude(page, ACME, 1)
    await addClaude(page, BILLING, 2)
    await addClaude(page, ACME, 3)
    await addClaude(page, BILLING, 4)
    writeSession(sandbox, SESSIONS.darkMode, sandbox.projectFolder, 'Add dark mode toggle', 'idle')
    writeSession(sandbox, SESSIONS.invoiceExport, billingFolder(sandbox), 'Refactor invoice export', 'busy')
    writeSession(sandbox, SESSIONS.loginTest, sandbox.projectFolder, 'Fix flaky login test', 'idle')
    writeSession(sandbox, SESSIONS.invoiceCsv, billingFolder(sandbox), 'Add invoice CSV export', 'idle')
    await page.locator('#layout-panel').click()
    await page.locator('.pane-strip .strip-tab', { hasText: 'Add dark mode toggle' }).click()
    const dark = page.locator('.pane:visible').first()
    await expect(dark.locator('.pane-title')).toHaveText(/Add dark mode toggle/, { timeout: 20_000 })
    await dark.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Chat', exact: true }).click()
    const panel = page.locator('.side-panel')
    await expect(panel.locator('.chat-turn-file')).toHaveCount(2, { timeout: 20_000 })
    await expect(panel.getByRole('tab', { name: /^Changes/ })).toContainText('2')
    await expect(panel.locator('.chat-turn-file', { hasText: 'settings.ts' })).toBeVisible()
    await expect(panel.locator('.chat-turn-file', { hasText: 'ThemeToggle.tsx' })).toBeVisible()
    await expect(page.locator('.pane-strip .strip-tab')).toHaveCount(4)
    await page.waitForTimeout(1200)
    await page.mouse.move(WINDOW.width - 4, WINDOW.height - 4)
    await saveSized(app, page, 'side-panel.png')
  } finally {
    await closeApp(app)
  }
})

test('Mini window: four sessions, one needing you with Allow and Deny', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  seedSettings(sandbox, {})
  writeTodos(sandbox, SESSIONS.darkMode, sandbox.projectFolder, 1)
  const { app, page } = await launchApp(sandbox)
  try {
    await setWindow(app, page)
    await addClaude(page, ACME, 1)
    await addClaude(page, BILLING, 2)
    await addClaude(page, ACME, 3)
    await addClaude(page, BILLING, 4)
    writeSession(sandbox, SESSIONS.darkMode, sandbox.projectFolder, 'Add dark mode toggle', 'busy')
    writeSession(sandbox, SESSIONS.invoiceExport, billingFolder(sandbox), 'Refactor invoice export', 'busy')
    writeSession(sandbox, SESSIONS.loginTest, sandbox.projectFolder, 'Fix flaky login test', 'idle')
    writeSession(sandbox, SESSIONS.invoiceCsv, billingFolder(sandbox), 'Add invoice CSV export', 'idle')
    for (const title of ['Add dark mode toggle', 'Refactor invoice export', 'Fix flaky login test', 'Add invoice CSV export']) {
      await expect(page.locator('.pane-title', { hasText: title })).toHaveCount(1, { timeout: 20_000 })
    }
    await makeNeedsYou(page, paneTitled(page, 'Add dark mode toggle'))
    const mini = await openMini(app, page)
    await expect(mini.locator('.mini-card')).toHaveCount(4, { timeout: 20_000 })
    await expect(mini.locator('.mini-card[data-state="needs"]')).toHaveCount(1, { timeout: 20_000 })
    await expect(mini.locator('.mini-card[data-state="needs"] .mini-allow')).toBeVisible()
    await expect(mini.locator('.mini-card[data-state="needs"]').getByRole('button', { name: 'Deny', exact: true })).toBeVisible()
    await mini.waitForTimeout(800)
    await mini.locator('#mini').screenshot({ path: join(SITE, 'mini-window.png') })
    await mini.close().catch(() => undefined)
  } finally {
    await closeApp(app)
  }
})

test('Appearance settings: Desktop app style card with Panes, Frame, Tone and opening layout rows', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  seedSettings(sandbox, {})
  const { app, page } = await launchApp(sandbox)
  try {
    await setWindow(app, page)
    await openSettings(page, 'appearance')
    await expect(page.locator('#settings-desktop-style')).toBeVisible()
    await expect(page.locator('#appearance-use-desktop')).toBeEnabled()
    await expect(page.getByRole('group', { name: 'Panes', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Frame', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Tone', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Layout when Dawsha opens', exact: true })).toBeVisible()
    await page.waitForTimeout(800)
    await saveSized(app, page, 'appearance-settings.png')
  } finally {
    await closeApp(app)
  }
})
