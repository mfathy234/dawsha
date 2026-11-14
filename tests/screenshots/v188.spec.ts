import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { bufferText, closeApp, createSandbox, feedTerminal, launchApp, openSettings, type Sandbox } from '../e2e/helpers'

// Dawsha 1.8.8 screenshots: Mini window detail, Context window, short session names and Find in Settings.
const SITE = process.env.DAWSHA_SHOTS_OUT ?? resolve(__dirname, '../../site/assets')
const AGENT = resolve(__dirname, '../support/chatAgent.cjs')
const WINDOW = { width: 1440, height: 900 }
// App shots are cropped to the top 1440x824 and resized to the 1168x668 site size.
const OUTPUT = { width: 1168, height: 668 }
const CROP = { x: 0, y: 0, width: 1440, height: 824 }

const ACME = 'acme-web'
const BILLING = 'billing-api'

const SESSIONS = {
  miniDetail: '3c8e1f2a-4b5d-4c6e-8f70-1a2b3c4d5e6f',
  context: '4d9f2a3b-5c6e-4d7f-9a81-2b3c4d5e6f70',
  nameOne: '5e0a3b4c-6d7e-4e80-8b92-3c4d5e6f7081',
  nameTwo: '6f1b4c5d-7e8f-4f91-9ca3-4d5e6f708192',
  nameThree: '7a2c5d6e-8f90-4aa2-8db4-5e6f708193a4'
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

function writeSession(sandbox: Sandbox, id: string, cwd: string, name: string, status: 'busy' | 'idle', nameSource: 'user' | 'derived' = 'user'): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${id}.json`),
    JSON.stringify({ pid: process.pid, sessionId: id, cwd, name, nameSource, status, startedAt: now + 1000, updatedAt: now + 1000 }),
    'utf8'
  )
}

function writeOps(sandbox: Sandbox, id: string, cwd: string, percent: number, tokens: number): void {
  mkdirSync(sandbox.opsDir, { recursive: true })
  const snapshot = { v: 1, sessionId: id, cwd, updatedAt: Date.now(), ended: false, model: 'claude-opus-5-5', agents: [], context: { percent, tokens, window: 200_000, stage: 'fine' }, compactions: 0, limits: [], files: [], checks: [] }
  writeFileSync(join(sandbox.opsDir, `${id}.json`), JSON.stringify(snapshot), 'utf8')
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

/** A working session: the asked prompt, a plan with one step done, an edit in progress and a text reply so far. */
function writeWorkingTranscript(sandbox: Sandbox, id: string): void {
  const todos = [
    { content: 'Move the totals into a module', status: 'completed', activeForm: 'Moving the totals into a module' },
    { content: 'Update the invoice export to use it', status: 'in_progress', activeForm: 'Updating the invoice export' },
    { content: 'Run the billing tests', status: 'pending', activeForm: 'Running the billing tests' }
  ]
  mkdirSync(join(transcript(sandbox, sandbox.projectFolder, id), '..'), { recursive: true })
  writeFileSync(
    transcript(sandbox, sandbox.projectFolder, id),
    [
      { type: 'user', uuid: 'u1', timestamp: iso(), message: { role: 'user', content: 'Move the invoice totals into their own module and use it from the export' } },
      { type: 'assistant', uuid: 'p1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tt', name: 'TodoWrite', input: { todos } }] } },
      { type: 'user', uuid: 'pr', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tt', content: 'ok' }] } },
      { type: 'assistant', uuid: 'e1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'src/invoices/totals.ts', content: 'export function invoiceTotal(lines: Line[]): number {\n  return lines.reduce((sum, line) => sum + line.amount, 0)\n}\n' } }] } },
      { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
      { type: 'assistant', uuid: 'a1', timestamp: iso(), message: { role: 'assistant', content: [{ type: 'text', text: 'Moved the totals into src/invoices/totals.ts.\n\nNext I will point the CSV export at it and run the billing tests.' }] } }
    ].map(line).join(''),
    'utf8'
  )
}

/** Real git changes so the detail's Changes row has files and line counts. */
function makeInvoiceChanges(sandbox: Sandbox): void {
  const root = sandbox.projectFolder
  mkdirSync(join(root, 'src', 'invoices'), { recursive: true })
  writeFileSync(join(root, 'src', 'invoices', 'export.ts'), 'export function exportCsv(rows: Row[]): string {\n  return rows.map(toLine).join("\\n")\n}\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'acme-web', private: true }))
  git(root, 'init', '-q', '-b', 'feat/invoice-totals')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'base')
  writeFileSync(join(root, 'src', 'invoices', 'totals.ts'), 'export function invoiceTotal(lines: Line[]): number {\n  return lines.reduce((sum, line) => sum + line.amount, 0)\n}\n')
  writeFileSync(join(root, 'src', 'invoices', 'export.ts'), 'import { invoiceTotal } from "./totals"\n\nexport function exportCsv(rows: Row[]): string {\n  return rows.map(toLine).join("\\n")\n}\n')
  git(root, 'update-ref', `refs/dawsha/checkpoints/${SESSIONS.miniDetail}/${createHash('sha1').update('u1').digest('hex').slice(0, 16)}`, 'HEAD')
}

test('Mini detail: a working session with the plan, changes, context, terminal and reply box', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  seedSettings(sandbox, {})
  makeInvoiceChanges(sandbox)
  writeWorkingTranscript(sandbox, SESSIONS.miniDetail)
  const { app, page } = await launchApp(sandbox, agentEnv(transcript(sandbox, sandbox.projectFolder, SESSIONS.miniDetail)))
  try {
    await setWindow(app, page)
    await addClaude(page, ACME, 1)
    writeSession(sandbox, SESSIONS.miniDetail, sandbox.projectFolder, 'Move invoice totals to a module', 'busy')
    writeOps(sandbox, SESSIONS.miniDetail, sandbox.projectFolder, 58, 116_000)
    await expect(page.locator('.pane-title', { hasText: 'Move invoice totals to a module' })).toHaveCount(1, { timeout: 20_000 })
    const termId = (await paneTitled(page, 'Move invoice totals to a module').locator('.term-host.active').getAttribute('data-term-id'))!
    await feedTerminal(page, termId, '\x1b[2J\x1b[H' + ['> Reading src/invoices/export.ts', '> Writing src/invoices/totals.ts', '$ '].join('\r\n'))
    const mini = await openMini(app, page)
    await mini.locator('.mini-card .mini-select').click()
    const detail = mini.locator('.mini-detail')
    await expect(detail.locator('.mini-asked')).toContainText('Move the invoice totals', { timeout: 20_000 })
    await expect(detail.locator('.mini-reply')).toContainText('Moved the totals into src/invoices/totals.ts.', { timeout: 20_000 })
    await expect(detail.locator('.mini-changes')).toContainText('file', { timeout: 20_000 })
    await expect(detail.locator('.mini-plan')).toBeVisible({ timeout: 20_000 })
    await expect(detail.locator('.mini-usage')).toContainText('Context 58%', { timeout: 20_000 })
    await expect(detail.locator('.mini-terminal')).toContainText('Reading src/invoices/export.ts', { timeout: 20_000 })
    await expect(detail.getByRole('textbox', { name: 'Message this session' })).toBeVisible()
    await mini.mouse.move(1, 1)
    await mini.waitForTimeout(800)
    await mini.locator('#mini').screenshot({ path: join(SITE, 'mini-detail.png') })
    await mini.close().catch(() => undefined)
  } finally {
    await closeApp(app)
  }
})

test('Context window: Quiet pane with the top bar frame and the context ring opened', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  seedSettings(sandbox, { appearance: { panes: 'quiet', frame: 'topbar', tone: 'cool' } })
  writeWorkingTranscript(sandbox, SESSIONS.context)
  const { app, page } = await launchApp(sandbox, agentEnv(transcript(sandbox, sandbox.projectFolder, SESSIONS.context)))
  try {
    await setWindow(app, page)
    writeOps(sandbox, SESSIONS.context, sandbox.projectFolder, 41, 82_000)
    await addClaude(page, ACME, 1)
    writeSession(sandbox, SESSIONS.context, sandbox.projectFolder, 'Move invoice totals', 'idle')
    const ring = page.locator('.pane .pane-header').getByRole('button', { name: /^Context 41% used/ })
    await expect(ring).toContainText('41%', { timeout: 20_000 })
    await ring.click()
    const pop = page.getByRole('dialog', { name: 'Context' })
    await expect(pop).toContainText('41% of 200K used', { timeout: 15_000 })
    await expect(pop).toContainText('Used 82K')
    await expect(pop).toContainText('Free 118K')
    await page.waitForTimeout(800)
    await page.mouse.move(WINDOW.width - 4, WINDOW.height - 4)
    await saveSized(app, page, 'context-window.png')
  } finally {
    await closeApp(app)
  }
})

test('Short names: three long first messages show their short titles in the sidebar and tab strip', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  const prompts: [string, string][] = [
    [SESSIONS.nameOne, String.raw`based on stage read this repo "C:\Users\demo\Downloads\security-report.html" and fix every finding. Keep each fix small, run the tests after each one, and list anything you could not reproduce so I can decide on it before anything is merged.`],
    [SESSIONS.nameTwo, 'Refactor the invoice export so the CSV columns come from one list instead of three places. Keep the JSON output exactly as it is today, add a test for the empty-month case, and run the billing test suite before you say it is done.'],
    [SESSIONS.nameThree, 'The login test in the web app is flaky. It waits a fixed two seconds and sometimes races the redirect after sign-in. Replace the sleep with a wait for the redirect, then run the test ten times in a row to check it is stable.']
  ]
  const file = join(sandbox.userData, 'settings.json')
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), sessionsLayout: 'panel' }), 'utf8')
  const { app, page } = await launchApp(sandbox)
  try {
    await setWindow(app, page)
    const dir = join(sandbox.claudeHome, 'projects', slug(sandbox.projectFolder))
    mkdirSync(dir, { recursive: true })
    for (const [id, text] of prompts) {
      writeFileSync(join(dir, `${id}.jsonl`), JSON.stringify({ type: 'user', message: { content: text } }) + '\n')
      writeSession(sandbox, id, sandbox.projectFolder, 'New session', 'idle', 'derived')
    }
    for (const count of [1, 2, 3]) {
      await page.getByRole('button', { name: /^New (Claude|Codex|Gemini) session in Smoke$/ }).first().click()
      await expect(page.locator('.pane')).toHaveCount(count, { timeout: 20_000 })
    }
    await page.locator('.pane:visible').first().waitFor()
    await tidyPane(page, page.locator('.pane:visible').first(), ['$ '])
    await page.waitForTimeout(3000)
    await saveSized(app, page, 'short-names.png')
  } finally {
    await closeApp(app)
  }
})

test('Find in Settings: searching for tone highlights the matching Appearance row', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  seedSettings(sandbox, {})
  const { app, page } = await launchApp(sandbox)
  try {
    await setWindow(app, page)
    await openSettings(page, 'general')
    const search = page.getByRole('searchbox', { name: 'Find in Settings' })
    await search.fill('tone')
    await expect(page.locator('.set-match').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.set-row.set-match', { hasText: 'Tone' })).toBeVisible()
    await page.waitForTimeout(600)
    await page.mouse.move(WINDOW.width - 4, WINDOW.height - 4)
    await saveSized(app, page, 'settings-find.png')
  } finally {
    await closeApp(app)
  }
})
