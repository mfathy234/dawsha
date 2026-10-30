import { createServer, type Server } from 'node:http'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, expect, test, type Page } from '@playwright/test'
import { backToAgents, closeApp, feedTerminal, runCli, type Sandbox } from '../e2e/helpers'
import { DEMO_ROOT, OUT as DOCS, folder, settle, writeClaudeSession } from './harness'
import { SITE, launchDemo, termIdOfPane } from './v17Demo'
import { makeRepo } from './v17Fixtures'

test.afterAll(() => rmSync(DEMO_ROOT, { recursive: true, force: true }))

type Clip = { x: number; y: number; width: number; height: number }

const boxOf = async (page: Page, selector: string, pad = 0): Promise<Clip> => {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`No box for ${selector}`)
  return { x: Math.max(0, Math.floor(box.x) - pad), y: Math.max(0, Math.floor(box.y) - pad), width: Math.ceil(box.width) + pad * 2, height: Math.ceil(box.height) + pad * 2 }
}

const spanOf = async (page: Page, first: string, last: string, pad = 16): Promise<Clip> => {
  const top = await boxOf(page, first)
  const bottom = await boxOf(page, last)
  const left = Math.min(top.x, bottom.x)
  const right = Math.max(top.x + top.width, bottom.x + bottom.width)
  return { x: left - pad, y: top.y - pad, width: right - left + pad * 2, height: bottom.y + bottom.height - top.y + pad * 2 }
}

const save = async (page: Page, targets: string[], clip?: Clip): Promise<void> => {
  const png = await page.screenshot(clip ? { clip } : undefined)
  for (const target of targets) writeFileSync(target, png)
}

const docs = (name: string): string => join(DOCS, name)
const site = (name: string): string => join(SITE, name)
const readSettings = (sandbox: Sandbox): any => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))

const CRLF = '\r\n'
const PROMPT = ['', '  npm test -- login', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join(CRLF)

async function openAgents(page: Page): Promise<void> {
  await page.locator('#background-button').click()
  await expect(page.locator('.crew-view')).toBeVisible()
}

async function addOwnAgent(page: Page): Promise<void> {
  await page.locator('#crew-new').click()
  await page.locator('.crew-form input[aria-label="Name"]').fill('Zed')
  await page.locator('.crew-form input[aria-label="Role"]').fill('Release checker')
  await page.locator('.crew-form textarea[aria-label="Instructions"]').fill('You check a release before it ships. Read only: never publish or push. List what is missing, most important first.')
  await page.locator('.crew-form textarea[aria-label="Prompt"]').fill('Check {{version}} on {{env}}')
  await page.locator('.crew-swatch[data-colour="cyan"]').click()
  await page.locator('.crew-radio[data-value="read"]').click()
  await expect(page.locator('.crew-item[data-member="new-agent"]')).toContainText('Release checker')
}

async function runAgent(page: Page, member: string, project: string, field: string, value: string): Promise<void> {
  await page.locator(`.crew-item[data-member="${member}"] .crew-runbtn`).click({ force: true })
  const dialog = page.getByRole('dialog', { name: new RegExp(`^Run ${member}`, 'i') })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(field).fill(value)
  await dialog.getByLabel('Project').selectOption({ label: project })
  await dialog.locator('#crew-run-go').click()
}

test('generates the Agents, Run dialog and agent panes screenshots', async () => {
  mkdirSync(DOCS, { recursive: true })
  mkdirSync(SITE, { recursive: true })
  const { app, page, sandbox } = await launchDemo({}, { panes: false })
  try {
    await openAgents(page)
    await addOwnAgent(page)
    await backToAgents(page)
    await page.locator('.crew-item[data-member="sami"] .crew-runbtn').click({ force: true })
    const dialog = page.getByRole('dialog', { name: /^Run Sami/i })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Target').fill('PR 8841')
    await dialog.getByLabel('Project').selectOption({ label: 'acme-web' })
    await dialog.getByRole('radio', { name: 'Claude · Opus', exact: true }).click()
    await page.waitForTimeout(600)
    await save(page, [site('agents-run.png')], await boxOf(page, '[role="dialog"]', 24))
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await runAgent(page, 'sami', 'acme-web', 'Target', 'PR 8841')
    await expect(page.locator('.pane')).toHaveCount(1)
    await openAgents(page)
    await runAgent(page, 'hana', 'billing-api', 'Scope', 'the invoice export')
    await expect(page.locator('.pane')).toHaveCount(2)
    await openAgents(page)
    await runAgent(page, 'omar', 'mobile-shell', 'Task', 'the flaky login test')
    await expect(page.locator('.pane')).toHaveCount(3)
    await openAgents(page)
    await runAgent(page, 'yara', 'docs-site', 'Topic', 'the installer')
    await expect(page.locator('.pane')).toHaveCount(4)
    await expect(page.locator('.pane-title', { hasText: 'Sami · PR 8841' })).toHaveCount(1)

    writeClaudeSession(sandbox, 'acme-web', 'Sami · PR 8841', 'busy')
    writeClaudeSession(sandbox, 'billing-api', 'Hana · the invoice export', 'busy')
    writeClaudeSession(sandbox, 'mobile-shell', 'Omar · the flaky login test', 'busy')
    writeClaudeSession(sandbox, 'docs-site', 'Yara · the installer', 'busy')
    const omarPane = page.locator('.pane', { hasText: 'Omar · ' })
    await page.locator('.pane', { hasText: 'Sami · ' }).locator('.pane-title').click()
    const id = await termIdOfPane(page, 2)
    await expect(async () => {
      await feedTerminal(page, id, PROMPT)
      await expect(omarPane).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
    }).toPass({ timeout: 30_000 })
    await settle(page, 1500)
    await save(page, [site('agent-panes.png')])

    await openAgents(page)
    await page.locator('.crew-item[data-member="sami"]').click()
    await page.locator('.crew-detail').evaluate((node) => (node.scrollTop = 0))
    await settle(page, 800)
    await save(page, [site('agents.png'), docs('agents.png')], await boxOf(page, '.crew-view'))
  } finally {
    await closeApp(app)
  }
})

function writePlan(sandbox: Sandbox, steps: unknown[]): string {
  const file = join(sandbox.root, 'plan.json')
  writeFileSync(file, JSON.stringify({ summary: 'Find the cause, fix it with a test, review once', steps }), 'utf8')
  return file
}

test('generates the Maya plan and board screenshots', async () => {
  const { app, page, sandbox } = await launchDemo({}, { panes: false })
  try {
    await openAgents(page)
    await page.getByLabel('Goal for Maya').fill('The login test fails about 1 in 7 CI runs. Find out why, fix it and get it ready for a PR.')
    await page.locator('.crew-goal-project').selectOption({ label: 'billing-api' })
    await page.locator('#crew-goal-go').click()
    await expect(page.locator('.pane')).toHaveCount(1)
    const id = readSettings(sandbox).crewGoals[0].id
    const plan = writePlan(sandbox, [
      { member: 'Omar', job: 'Fix the wait in the login test, in a new worktree, with a test', fields: { task: 'fix the flaky login test' } },
      { member: 'Hana', job: 'Run the whole login suite 20 times to prove the fix', model: 'haiku', fields: { scope: 'the login suite' } },
      { member: 'Sami', job: 'Review the whole change once', model: 'haiku', fields: { target: 'the fix branch' } }
    ])
    const approved = runCli(sandbox, ['crew', 'plan', '--goal', id, '--file', plan])
    await expect(page.locator('.crew-plan')).toBeVisible()
    await page.locator('.crew-plan').evaluate((node) => node.scrollIntoView({ block: 'start' }))
    await settle(page, 800)
    await save(page, [site('lead-plan.png')], await spanOf(page, '.crew-plan', '.crew-plan'))

    await page.locator('#crew-plan-approve').click()
    expect((await approved).out).toBe('approved')
    await expect(page.locator('.crew-lane')).toHaveCount(3)
    const omar = await runCli(sandbox, ['crew', 'run', 'omar', '--goal', id, '--field', 'task=fix the flaky login test', '--background'])
    expect(omar.code).toBe(0)
    await expect(page.locator('.pane')).toHaveCount(2)
    const hana = await runCli(sandbox, ['crew', 'run', 'hana', '--goal', id, '--model', 'haiku', '--field', 'scope=the login suite', '--background'])
    expect(hana.code).toBe(0)
    await expect(page.locator('.pane')).toHaveCount(3)
    const term = await termIdOfPane(page, 2)
    await feedTerminal(page, term, '\x1b[2J\x1b[H\r\n> Run the login suite 20 times\r\n\r\n\x1b[33m✻\x1b[0m Running the login suite, 12 of 20… \x1b[2m(esc to interrupt)\x1b[0m\r\n')
    await expect(page.locator('.crew-lane[data-lane="2"] .crew-av')).toHaveAttribute('data-state', 'working', { timeout: 30_000 })
    const omarTerm = await termIdOfPane(page, 1)
    await expect(async () => {
      await feedTerminal(page, omarTerm, PROMPT)
      await expect(page.locator('.crew-lane[data-lane="1"] .crew-av')).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
    }).toPass({ timeout: 30_000 })
    expect((await runCli(sandbox, ['crew', 'note', '--goal', id, 'Omar is waiting for your OK to run the login tests. Hana is running the suite. Sami reviews when it passes.'])).code).toBe(0)
    const asked = runCli(sandbox, ['crew', 'ask', '--goal', id, 'Omar and Hana are on the fix. Once it passes 20 of 20 runs, should I push the branch and open a PR?', '--option', 'Push and open the PR', '--option', 'Keep it local'])
    await expect(page.locator('.crew-question')).toBeVisible()
    await page.locator('.crew-body').evaluate((node) => (node.scrollTop = node.scrollHeight))
    await settle(page, 800)
    await save(page, [site('lead-board.png')], await spanOf(page, '.crew-board', '.crew-lead-notes'))
    await page.locator('.crew-question').getByRole('button', { name: 'Keep it local' }).click()
    await asked
  } finally {
    await closeApp(app)
  }
})

test('generates the sidebar zones screenshot', async () => {
  const quiet = ['design-system', 'infra-scripts', 'marketing-site', 'old-prototype']
  quiet.forEach((name, index) => makeRepo(folder(name), name, ['feature/tokens', 'chore/deploy-scripts', 'main-copy', 'spike/offline'][index], {}))
  const projects = [
    { id: 'acme-web', name: 'acme-web', defaultAgent: 'claude' },
    { id: 'billing-api', name: 'billing-api', defaultAgent: 'claude' },
    { id: 'mobile-shell', name: 'mobile-shell', defaultAgent: 'codex' },
    { id: 'docs-site', name: 'docs-site', defaultAgent: 'gemini' },
    ...quiet.map((name) => ({ id: name, name, defaultAgent: 'claude', ...(name === 'design-system' ? { pinned: true } : {}) }))
  ].map((project) => ({ ...project, folder: folder(project.name) }))
  const { app, page } = await launchDemo({ projects })
  try {
    await page.locator('.pane-title', { hasText: 'Add dark mode toggle' }).click()
    await settle(page, 1200)
    await expect(page.locator('.quiet-sec')).toContainText('No sessions · 3')
    const rail = await boxOf(page, '.sidebar')
    const last = (await page.locator('.proj-group.zone-quiet').last().boundingBox())!
    await save(page, [site('sidebar-zones.png')], { ...rail, height: Math.min(rail.height, Math.ceil(last.y + last.height - rail.y) + 16) })
  } finally {
    await closeApp(app)
  }
})

test('generates the Files Problems screenshot', async () => {
  const { app, page } = await launchDemo({})
  try {
    const root = folder('acme-web')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'acme-web', version: '1.4.0', private: true, scripts: { build: 'node check.cjs' } }), 'utf8')
    writeFileSync(join(root, 'check.cjs'), [
      "console.log(\"src/context/theme.tsx(24,50): error TS2322: Type 'Theme | null' is not assignable to type 'Theme'.\")",
      "console.log(\"src/components/Settings.tsx(8,7): error TS2741: Property 'label' is missing in type '{}' but required in type 'ThemeToggleProps'.\")",
      "console.log('src/lib/storage.ts(3,7): warning TS6133: KEY is declared but never used.')",
      ''
    ].join('\n'), 'utf8')
    await page.locator('.pane-title', { hasText: 'Add dark mode toggle' }).click()
    await page.locator('#files-button').click()
    await expect(page.locator('#files-view')).toBeVisible()
    for (const path of ['src', 'src/context', 'src/components']) await page.locator(`.files-row[data-path="${path}"]`).click()
    await page.locator('.files-row[data-path="src/context/theme.tsx"]').dblclick()
    await expect(page.locator('.files-editor:not([hidden]) .cm-content')).toContainText('ThemeProvider')
    await page.locator('#files-run-toggle').click()
    await expect(page.locator('#run-source')).toContainText('package.json')
    const commandId = await page.locator('#run-command').evaluate((node) => [...(node as HTMLSelectElement).options].find((option) => /build/i.test(option.textContent ?? ''))?.value)
    await page.locator('#run-command').selectOption(commandId!)
    await page.locator('#run-start').click()
    await expect(page.locator('#files-ptab-problems')).toHaveText('Problems 3', { timeout: 30_000 })
    await page.locator('#files-ptab-problems').click()
    await expect(page.locator('#files-problems-summary')).toHaveText('2 errors, 1 warning')
    await page.locator('.files-problem[data-path="src/context/theme.tsx"] .files-problem-open').click()
    await expect(page.locator('#files-status')).toContainText('Ln 24')
    await settle(page, 1000)
    await save(page, [site('files-problems.png'), docs('files-problems.png')], await boxOf(page, '#files-view'))
  } finally {
    await closeApp(app)
  }
})

const renderer = resolve(process.cwd(), 'out/renderer')

function startStaticServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname === '/dawsha/' || pathname === '/dawsha') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(readFileSync(join(renderer, 'remote.html')))
      return
    }
    if (pathname.startsWith('/dawsha/assets/')) {
      const name = pathname.slice('/dawsha/assets/'.length)
      if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
        response.writeHead(404).end()
        return
      }
      try {
        const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'application/octet-stream'
        response.writeHead(200, { 'Content-Type': type })
        response.end(readFileSync(join(renderer, 'assets', name)))
      } catch {
        response.writeHead(404).end()
      }
      return
    }
    response.writeHead(404).end()
  })
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Remote server failed to bind.')
      done({ server, url: `http://127.0.0.1:${address.port}/dawsha/` })
    })
  )
}

const MEMBERS = [
  { id: 'sami', name: 'Sami', role: 'Code reviewer', initials: 'SA', colour: 'red', fields: ['target'], models: ['default', 'opus', 'sonnet'], projects: [], state: 'working' },
  { id: 'tarek', name: 'Tarek', role: 'Debugger', initials: 'TA', colour: 'blue', fields: ['problem'], models: ['default', 'codex'], projects: [], state: 'idle' },
  { id: 'omar', name: 'Omar', role: 'Builder', initials: 'OM', colour: 'green', fields: ['task'], models: ['default', 'opus', 'sonnet'], projects: [], state: 'needs' },
  { id: 'hana', name: 'Hana', role: 'Tester', initials: 'HA', colour: 'yellow', fields: ['scope'], models: ['default', 'sonnet', 'haiku'], projects: [], state: 'done' },
  { id: 'lina', name: 'Lina', role: 'UI polisher', initials: 'LI', colour: 'pink', fields: ['screen'], models: ['default', 'sonnet'], projects: [], state: 'idle' },
  { id: 'nour', name: 'Nour', role: 'Docs and releases', initials: 'NO', colour: 'cyan', fields: ['version'], models: ['default', 'gemini'], projects: [], state: 'idle' },
  { id: 'yara', name: 'Yara', role: 'Explainer', initials: 'YA', colour: 'orange', fields: ['topic'], models: ['default', 'sonnet'], projects: [], state: 'idle' },
  { id: 'zed', name: 'Zed', role: 'Release checker', initials: 'ZE', colour: 'cyan', fields: ['version', 'env'], models: ['default'], projects: [], state: 'idle' }
]

const JOBS = [
  { runId: 'run1', memberId: 'sami', name: 'Sami', initials: 'SA', colour: 'red', task: 'PR 8841', state: 'working', line: 'Working on it', termId: 'terminal-9' },
  { runId: 'run2', memberId: 'omar', name: 'Omar', initials: 'OM', colour: 'green', task: 'the login test', state: 'needs', line: 'Waiting for you. Answer it in Needs you or on the PC', termId: 'terminal-8' }
]

test('generates the phone Agents screenshot from a mocked Remote page', async () => {
  const { server, url } = await startStaticServer()
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' })
    const page = await context.newPage()
    await page.route('**/dawsha/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      const reply = (body: unknown): Promise<void> => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      if (path.endsWith('/api/state')) {
        await reply({
          device: { id: 'device-1', name: 'Pixel 9' },
          projects: [{ id: 'acme-web', name: 'acme-web', defaultAgent: 'claude', sessions: [] }, { id: 'billing-api', name: 'billing-api', defaultAgent: 'claude', sessions: [] }],
          terminals: [],
          permissions: { read: true, terminalInput: false, sessionControl: false, approvals: true, commands: true, answers: true, crew: true, fullOutput: false }
        })
        return
      }
      if (path.endsWith('/api/crew')) {
        await reply({ members: MEMBERS, jobs: JOBS, goal: { title: 'Fix the flaky login test', state: 'working', line: 'Working on it' } })
        return
      }
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' })
    })
    await page.goto(url)
    await expect(page.locator('#workspace-view')).toBeVisible()
    await page.locator('#remote-nav-crew').click()
    await expect(page.locator('#crew-view')).toBeVisible()
    await expect(page.locator('.pc-member')).toHaveCount(8)
    await expect(page.locator('.pc-job-head')).toHaveCount(3)
    await page.waitForTimeout(700)
    await page.screenshot({ path: site('phone-agents.png') })
    await context.close()
  } finally {
    await browser.close()
    await new Promise<void>((done) => server.close(() => done()))
  }
})

test('generates the Remote Access page screenshot', async () => {
  const { app, page } = await launchDemo({}, { panes: false })
  try {
    const now = Date.now()
    const state = {
      status: 'available',
      enabled: true,
      url: 'https://quiet-river-1234.trycloudflare.com/dawsha/',
      message: 'Remote Access is on.',
      notice: null,
      devices: [{ id: 'd1', name: 'Pixel 9', pairedAt: now - 9 * 86_400_000, lastSeenAt: now - 40_000 }],
      pairing: { code: '482913', expiresAt: now + 5 * 60_000 },
      permissions: {
        allowedEmail: '',
        capabilities: { commands: true, answers: true, messages: true, sessions: false, fullOutput: false, crew: true },
        autoReconnect: true,
        notifyLinkChange: true,
        approvalsNotify: true,
        approvalsOnlyWhenAway: false,
        approvalsAwayMinutes: 3,
        approvalsAllowConfigEdits: false
      },
      droppedAt: null,
      linkChangedAt: now - 3 * 3_600_000,
      roundTripMs: 84,
      checkedAt: now - 10_000,
      activity: [
        { id: 'a1', time: now - 4 * 60_000, device: 'Pixel 9', action: 'crew-run', session: null, detail: 'Sami · PR 8841' },
        { id: 'a2', time: now - 11 * 60_000, device: 'Pixel 9', action: 'approved', session: 'Add dark mode toggle', detail: 'npm install' },
        { id: 'a3', time: now - 52 * 60_000, device: 'Pixel 9', action: 'paired', session: null, detail: '' }
      ]
    }
    await app.evaluate(({ ipcMain }, initial) => {
      const holder = globalThis as unknown as { __remote: unknown }
      holder.__remote = initial
      ipcMain.removeHandler('remote-access:get')
      ipcMain.handle('remote-access:get', () => holder.__remote)
      ipcMain.removeHandler('remote-access:verify')
      ipcMain.handle('remote-access:verify', () => ({ ok: true, state: holder.__remote }))
    }, state)
    await page.reload()
    await page.waitForSelector('html[data-ready="true"]')
    await page.locator('#settings-button').click()
    await page.locator('#settings-tab-remote').click()
    await expect(page.locator('.remote-qr')).toBeVisible()
    await expect(page.locator('#remote-status.ra-on')).toContainText('Your phone can reach this PC')
    await settle(page, 1200)
    await save(page, [site('remote-access.png')], { x: 252, y: 56, width: 836, height: 944 })
  } finally {
    await closeApp(app)
  }
})
