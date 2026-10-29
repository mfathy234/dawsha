import { createServer, type Server } from 'node:http'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const renderer = resolve(process.cwd(), process.env.DAWSHA_PRIVATE_REMOTE_BUILD === '1' ? 'out/renderer-private' : 'out/renderer')
const shots = process.env.DAWSHA_SHOTS ?? 'test-results/screens'
const FAKE = resolve(__dirname, '../support/fakeAgent.cjs')

function startStaticServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    try {
      if (pathname === '/dawsha/' || pathname === '/dawsha') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(readFileSync(join(renderer, 'remote.html')))
        return
      }
      if (pathname.startsWith('/dawsha/assets/')) {
        const name = pathname.slice('/dawsha/assets/'.length)
        if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error('bad name')
        const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'application/octet-stream'
        response.writeHead(200, { 'Content-Type': type })
        response.end(readFileSync(join(renderer, 'assets', name)))
        return
      }
    } catch { /* falls through to 404 */ }
    response.writeHead(404).end()
  })
  return new Promise((resolvePromise) => server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Static server failed to bind.')
    resolvePromise({ server, url: `http://127.0.0.1:${address.port}/dawsha/` })
  }))
}

const MEMBERS = [
  { id: 'rami', name: 'Rami', role: 'PR reviewer', initials: 'RA', colour: 'orange', fields: ['pr'], models: ['default', 'opus', 'fable', 'codex'], projects: [], state: 'idle' },
  { id: 'sami', name: 'Sami', role: 'Code reviewer', initials: 'SA', colour: 'red', fields: ['target'], models: ['default', 'opus', 'sonnet'], projects: [], state: 'working' },
  { id: 'tarek', name: 'Tarek', role: 'Tester', initials: 'TA', colour: 'blue', fields: ['task'], models: ['default', 'codex'], projects: ['Billing'], state: 'needs' },
  { id: 'omar', name: 'Omar', role: 'Test writer', initials: 'OM', colour: 'cyan', fields: ['task'], models: ['default'], projects: [], state: 'done' }
]

const JOBS = [
  { runId: 'run1', memberId: 'sami', name: 'Sami', initials: 'SA', colour: 'red', task: 'PR 8841', state: 'working', line: 'Working on it', termId: 'terminal-9' },
  { runId: 'run2', memberId: 'tarek', name: 'Tarek', initials: 'TA', colour: 'blue', task: 'the login test', state: 'needs', line: 'Waiting for you. Answer it in Needs you or on the PC', termId: 'terminal-8' }
]

interface PhoneMock { crew: boolean; fullOutput: boolean; runs: unknown[]; crewCalls: number; runError: string | null }

async function installMocks(page: Page, mock: PhoneMock): Promise<void> {
  await page.route('**/dawsha/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const reply = (status: number, body: unknown): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path.endsWith('/api/state')) {
      await reply(200, {
        device: { id: 'device-1', name: 'Test phone' },
        projects: [{ id: 'p1', name: 'Platforms', defaultAgent: 'claude', sessions: [] }, { id: 'p2', name: 'Billing', defaultAgent: 'claude', sessions: [] }],
        terminals: [],
        permissions: { read: true, terminalInput: false, sessionControl: false, approvals: false, commands: false, answers: false, crew: mock.crew, fullOutput: mock.fullOutput }
      })
      return
    }
    if (path.endsWith('/api/crew/run') && request.method() === 'POST') {
      if (!mock.crew) { await reply(403, { error: 'Running agents from the phone is turned off in Dawsha settings.' }); return }
      if (mock.runError) { await reply(400, { error: mock.runError }); return }
      mock.runs.push(request.postDataJSON())
      await reply(200, { runId: 'run99' })
      return
    }
    if (path.endsWith('/api/crew')) {
      mock.crewCalls += 1
      if (!mock.crew) { await reply(403, { error: 'Running agents from the phone is turned off in Dawsha settings.' }); return }
      await reply(200, { members: MEMBERS, jobs: JOBS, goal: { title: 'Fix the flaky login test', state: 'working', line: 'Working on it' } })
      return
    }
    await reply(404, { error: 'not found' })
  })
}

async function openPhone(browser: Browser, url: string, mock: PhoneMock, scheme: 'dark' | 'light'): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme })
  const page = await context.newPage()
  await installMocks(page, mock)
  await page.goto(url)
  await expect(page.locator('#workspace-view')).toBeVisible()
  await page.locator('#remote-nav-crew').click()
  await expect(page.locator('#crew-view')).toBeVisible()
  return page
}

test('phone Agents tab: with the capability off it shows the off message, no controls, and the endpoints refuse', async () => {
  test.setTimeout(60_000)
  const { server, url } = await startStaticServer()
  let browser: Browser | undefined
  const mock: PhoneMock = { crew: false, fullOutput: false, runs: [], crewCalls: 0, runError: null }
  try {
    browser = await chromium.launch({ headless: true })
    const page = await openPhone(browser, url, mock, 'dark')
    await expect(page.locator('#crew-off')).toHaveText('Running agents from the phone is off. Turn it on in Remote Access on your PC.')
    await expect(page.locator('#crew-root button')).toHaveCount(0)
    await expect(page.locator('#crew-root input, #crew-root select')).toHaveCount(0)
    expect(mock.crewCalls).toBe(0)
    const refused = await page.evaluate(async () => {
      const list = await fetch('/dawsha/api/crew', { cache: 'no-store' })
      const run = await fetch('/dawsha/api/crew/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      return [list.status, run.status]
    })
    expect(refused).toEqual([403, 403])
    expect(mock.runs).toEqual([])
    mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: `${shots}/remote-phone-agents-off.png` })
  } finally {
    await browser?.close()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
})

test('phone Agents tab: the grid, a run card with fields, project and model, running jobs and a status, at 390px in dark and light', async () => {
  test.setTimeout(90_000)
  const { server, url } = await startStaticServer()
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({ headless: true })
    for (const scheme of ['dark', 'light'] as const) {
      const mock: PhoneMock = { crew: true, fullOutput: false, runs: [], crewCalls: 0, runError: null }
      const page = await openPhone(browser, url, mock, scheme)
      await expect(page.getByRole('tab')).toHaveText(['Needs you', 'Agents', 'Sessions', 'Projects'])
      await expect(page.locator('#remote-nav-crew')).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('.pc-member')).toHaveCount(4)
      const columns = await page.locator('.pc-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
      expect(columns).toBe(4)
      await expect(page.locator('.pc-member').first()).toContainText('Rami')
      await expect(page.locator('.pc-member .crew-av[data-state="working"]')).toHaveAttribute('aria-label', 'Sami, Working')
      await expect(page.locator('.pc-member .crew-av[data-state="needs"]')).toHaveCount(1)
      await expect(page.locator('#crew-run-card')).toHaveCount(0)

      await page.locator('#crew-member-rami').click()
      const card = page.locator('#crew-run-card')
      await expect(card).toContainText('Run Rami')
      await expect(card.locator('#crew-field-pr')).toBeVisible()
      await expect(card.locator('#crew-project option')).toHaveText(['Platforms', 'Billing'])
      await expect(card.getByRole('radio')).toHaveText(['Default', 'Opus', 'Fable', 'Codex'])
      await expect(card.getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true')
      const run = card.locator('#crew-run')
      await expect(run).toHaveText('Run Rami')
      expect((await run.boundingBox())!.height).toBeGreaterThanOrEqual(48)
      const chipHeight = (await card.getByRole('radio').first().boundingBox())!.height
      expect(chipHeight).toBeGreaterThanOrEqual(44)

      await page.locator('#crew-member-tarek').click()
      await expect(page.locator('#crew-project option')).toHaveText(['Billing'])
      await page.locator('#crew-member-rami').click()

      await expect(page.locator('#crew-jobs h2')).toHaveText('On a job')
      await expect(page.locator('.pc-job-head')).toHaveCount(3)
      await expect(page.locator('.pc-job-title').nth(1)).toContainText('Sami · PR 8841')
      await expect(page.locator('.pc-goal')).toContainText('Fix the flaky login test')

      const style = await card.evaluate((element) => {
        const computed = getComputedStyle(element)
        return { shadow: computed.boxShadow, border: computed.borderTopWidth, radius: computed.borderTopLeftRadius }
      })
      expect(style.shadow).toBe('none')
      expect(style.border).toBe('0px')
      const caps = await page.evaluate(() => {
        const found: string[] = []
        for (const element of document.querySelectorAll<HTMLElement>('#crew-root *')) {
          if (getComputedStyle(element).textTransform === 'uppercase') found.push(element.textContent ?? '')
        }
        return found
      })
      expect(caps).toEqual([])
      const pill = await page.locator('.pc-chip').first().evaluate((element) => parseFloat(getComputedStyle(element).borderTopLeftRadius))
      expect(pill).toBeLessThan(20)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      mkdirSync(shots, { recursive: true })
      await page.screenshot({ path: `${shots}/remote-phone-agents-${scheme}.png`, fullPage: true })

      await page.locator('.pc-job-head').nth(1).click()
      await expect(page.locator('.pc-job-detail')).toContainText('Full output is off')
      await expect(page.locator('.pc-job-detail button')).toHaveCount(0)
      await page.screenshot({ path: `${shots}/remote-phone-agents-status-${scheme}.png`, fullPage: true })

      await page.locator('#crew-field-pr').fill('PR 412')
      await page.getByRole('radio', { name: 'Opus' }).click()
      await page.locator('#crew-run').click()
      await expect.poll(() => mock.runs.length).toBe(1)
      expect(mock.runs[0]).toEqual({ member: 'rami', project: 'p1', model: 'opus', fields: { pr: 'PR 412' } })
      await expect(page.locator('#crew-done')).toHaveText('Rami started on your PC.')
      await expect(page.locator('#crew-run-card')).toHaveCount(0)
      await page.context().close()
    }
  } finally {
    await browser?.close()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
})

test('phone Agents tab: a refused run shows the reason, and a running agent opens its output only when full output is on', async () => {
  test.setTimeout(60_000)
  const { server, url } = await startStaticServer()
  let browser: Browser | undefined
  const mock: PhoneMock = { crew: true, fullOutput: true, runs: [], crewCalls: 0, runError: 'Rami is limited to Billing.' }
  try {
    browser = await chromium.launch({ headless: true })
    const page = await openPhone(browser, url, mock, 'dark')
    await page.locator('#crew-member-rami').click()
    await page.locator('#crew-field-pr').fill('PR 1')
    await page.locator('#crew-run').click()
    await expect(page.locator('#crew-run-card [role="alert"]')).toHaveText('Rami is limited to Billing.')
    await expect(page.locator('#crew-field-pr')).toHaveValue('PR 1')
    expect(mock.runs).toEqual([])
    await page.locator('.pc-job-head').nth(1).click()
    await expect(page.getByRole('button', { name: 'Read the output' })).toBeVisible()
    await page.getByRole('button', { name: 'Read the output' }).click()
    await expect(page.locator('#terminal-view')).toBeVisible()
  } finally {
    await browser?.close()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
})

test('desktop: a phone run opens a pane titled with the agent, the live state goes back to the phone, and the PC names the run in its log', async () => {
  test.setTimeout(90_000)
  const sandbox = createSandbox()
  const node = process.execPath
  const { app, page } = await launchApp(sandbox, {
    FAKE_AGENT_LOG: join(sandbox.root, 'agent-log'),
    DAWSHA_CLAUDE_COMMAND: node,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([FAKE, 'claude']),
    DAWSHA_SHARED_HOME: join(sandbox.root, 'shared-home')
  })
  try {
    await app.evaluate(({ ipcMain }) => {
      const holder = globalThis as unknown as { __crew: { snapshots: unknown[]; results: unknown[] } }
      holder.__crew = { snapshots: [], results: [] }
      ipcMain.on('remote-crew:snapshot', (_event, snapshot) => holder.__crew.snapshots.push(snapshot))
      ipcMain.on('remote-crew:run-result', (_event, id, result) => holder.__crew.results.push({ id, result }))
    })
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('remote-crew:run', 'req-1', { memberId: 'sami', projectId: 'smoke', choice: 'default', fields: { target: 'PR 8841' } })
    })
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane-title')).toContainText('Sami · PR 8841')
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __crew: { results: unknown[] } }).__crew.results.length)).toBe(1)
    const reply = (await app.evaluate(() => (globalThis as unknown as { __crew: { results: Array<{ id: string; result: { ok: boolean; runId?: string } }> } }).__crew.results))[0]
    expect(reply.id).toBe('req-1')
    expect(reply.result.ok).toBe(true)
    expect(reply.result.runId).toBeTruthy()
    await expect.poll(async () => {
      const snapshots = await app.evaluate(() => (globalThis as unknown as { __crew: { snapshots: Array<{ jobs: Array<{ name: string; task: string }> }> } }).__crew.snapshots)
      return snapshots.at(-1)?.jobs[0]
    }).toMatchObject({ name: 'Sami', task: 'PR 8841' })
    const last = JSON.stringify(await app.evaluate(() => (globalThis as unknown as { __crew: { snapshots: unknown[] } }).__crew.snapshots.at(-1)))
    expect(last).not.toContain('You are a code reviewer')
    expect(last).not.toContain(sandbox.projectFolder.replace(/\\/g, '\\\\'))

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('remote-crew:run', 'req-2', { memberId: 'nobody', projectId: 'smoke', choice: 'default', fields: {} })
    })
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __crew: { results: unknown[] } }).__crew.results.length)).toBe(2)
    await expect(page.locator('.pane')).toHaveCount(1)
  } finally {
    await closeApp(app)
  }
})

test('desktop: Run agents is a capability, off until confirmed by name', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.locator('#settings-button').click()
    await page.locator('#settings-tab-remote').click()
    const crew = page.locator('#remote-cap-crew')
    await expect(crew).not.toBeChecked()
    await expect(page.locator('#remote-capabilities')).toContainText('Run agents')
    await expect(page.locator('#remote-capabilities')).toContainText("Runs use the agent's own permissions.")
    await crew.check()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Allow phones to run agents?')
    await dialog.getByRole('button', { name: 'Allow running agents' }).click()
    await expect(crew).toBeChecked()
    const stored = await page.evaluate(async () => (await window.gridApi.remoteAccess!.getState()).permissions)
    expect(stored).toMatchObject({ capabilities: { crew: true, sessions: false, fullOutput: false } })
  } finally {
    await closeApp(app)
  }
})

test('desktop: the Remote Access activity log says which agent a phone ran and where', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await app.evaluate(({ ipcMain }) => {
      const state = () => ({
        status: 'available', enabled: true, url: 'https://quiet-river-1234.trycloudflare.com/dawsha/', message: 'Remote Access is on.', notice: null, devices: [],
        pairing: { code: '482913', expiresAt: Date.now() + 300_000 },
        permissions: { allowedEmail: '', capabilities: { commands: false, answers: false, messages: false, sessions: false, crew: true, fullOutput: false }, autoReconnect: true, notifyLinkChange: true, approvalsNotify: true, approvalsOnlyWhenAway: false, approvalsAwayMinutes: 3, approvalsAllowConfigEdits: false },
        droppedAt: null, linkChangedAt: Date.now(), roundTripMs: 80, checkedAt: Date.now(),
        activity: [{ id: '1', time: Date.now() - 30_000, device: 'Pixel 9', action: 'crew-run', session: 'Platforms', detail: 'Rami' }]
      })
      ipcMain.removeHandler('remote-access:get')
      ipcMain.handle('remote-access:get', state)
      ipcMain.removeHandler('remote-access:verify')
      ipcMain.handle('remote-access:verify', () => ({ ok: true, state: state() }))
    })
    await page.reload()
    await page.locator('#settings-button').click()
    await page.locator('#settings-tab-remote').click()
    await expect(page.locator('#remote-activity')).toContainText('Pixel 9 ran Rami on Platforms')
  } finally {
    await closeApp(app)
  }
})
