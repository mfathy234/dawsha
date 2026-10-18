import { createServer, type Server } from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, expect, test, type Browser, type Page, type WebSocketRoute } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

const renderer = resolve(process.cwd(), process.env.DAWSHA_PRIVATE_REMOTE_BUILD === '1' ? 'out/renderer-private' : 'out/renderer')
const terminalFixture = 'prefix line\nline after bare LF\r\n\u001b[31mANSI red marker\u001b[0m\r\n\u001b[32mANSI green marker\u001b[0m\r\n\u001b[33mANSI yellow marker\u001b[0m\r\n\u001b[34mANSI blue marker\u001b[0m\r\nRemote session ready\r\n'

function startStaticServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname === '/dawsha/' || pathname === '/dawsha') {
      try {
        const html = readFileSync(join(renderer, 'remote.html'))
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(html)
      } catch { response.writeHead(404).end('Missing private remote page') }
      return
    }
    if (pathname.startsWith('/dawsha/assets/')) {
      const name = pathname.slice('/dawsha/assets/'.length)
      if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.includes('..')) {
        response.writeHead(404).end()
        return
      }
      try {
        const file = join(renderer, 'assets', name)
        const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'application/octet-stream'
        response.writeHead(200, { 'Content-Type': type })
        response.end(readFileSync(file))
      } catch { response.writeHead(404).end() }
      return
    }
    response.writeHead(404).end()
  })
  return new Promise((resolvePromise) => server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Remote E2E server failed to bind.')
    resolvePromise({ server, url: `http://127.0.0.1:${address.port}/dawsha/` })
  }))
}

interface MockControls {
  paired: boolean
  canControl: boolean
  writes: string[]
  writeTimes: number[]
  inputAttempts: string[]
  inputFailures: number
  inputDelayMs: number
  resizes: Array<{ id: string; cols: number; rows: number }>
  sessions: unknown[]
  stoppedSessionIds: Set<string>
  outputConnections: number
  closeFirstOutput: boolean
  terminalEnded: boolean
  snapshotSize?: { cols: number; rows: number }
  outputSocket?: WebSocketRoute
  pairBodies?: unknown[]
  approvals?: boolean
}

async function installApiMocks(page: Page, controls: MockControls): Promise<void> {
  await page.routeWebSocket('**/api/terminal/output*', (socket) => {
    controls.outputConnections += 1
    if (controls.closeFirstOutput && controls.outputConnections === 1) {
      socket.close({ code: 1013, reason: 'Output buffer exceeded' })
      return
    }
    controls.outputSocket = socket
    socket.send(JSON.stringify({ event: 'snapshot', data: { id: 'terminal-1', output: terminalFixture, ...controls.snapshotSize } }))
  })
  await page.route('**/dawsha/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path.endsWith('/api/pair') && request.method() === 'POST') {
      controls.pairBodies?.push(request.postDataJSON())
      controls.paired = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deviceId: 'device-1' }) })
      return
    }
    if (path.endsWith('/api/state')) {
      if (!controls.paired) {
        await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Pair this browser"}' })
        return
      }
      const createdAgent = (controls.sessions.at(-1) as { agent?: 'claude' | 'codex' | 'gemini' } | undefined)?.agent
      const createdTerminalId = `terminal-${controls.sessions.length + 1}`
      const state = {
        device: { id: 'device-1', name: 'Test phone' },
        projects: [{ id: 'project-1', name: 'Sample project', defaultAgent: 'codex', sessions: [
          { id: 'session-1', title: 'Existing session', modifiedAt: 2, agent: 'codex' },
          { id: 'session-gemini', title: 'Gemini exploration', modifiedAt: 1, agent: 'gemini' }
        ] }],
        terminals: [
          { id: 'terminal-1', projectId: 'project-1', agent: 'codex', startedAt: 1, output: 'Remote session ready\r\n' },
          ...(createdAgent && !controls.stoppedSessionIds.has(createdTerminalId) ? [{ id: createdTerminalId, projectId: 'project-1', agent: createdAgent, startedAt: 2, output: 'New session ready\r\n', remoteManaged: true }] : [])
        ].filter(() => !controls.terminalEnded),
        permissions: { read: true, terminalInput: controls.canControl, sessionControl: controls.canControl, approvals: controls.approvals === true }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
      return
    }
    if (path.endsWith('/api/terminal/input')) {
      const body = request.postDataJSON() as { data: string }
      controls.inputAttempts.push(body.data)
      if (controls.inputDelayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, controls.inputDelayMs))
      if (controls.inputFailures > 0) {
        controls.inputFailures -= 1
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Cloudflare Quick Tunnel is not ready."}' })
        return
      }
      controls.writes.push(body.data)
      controls.writeTimes.push(Date.now())
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
      return
    }
    if (path.endsWith('/api/terminal/resize')) {
      controls.resizes.push(request.postDataJSON() as { id: string; cols: number; rows: number })
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
      return
    }
    if (path.endsWith('/api/session')) {
      controls.sessions.push(request.postDataJSON())
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: `terminal-${controls.sessions.length + 1}` }) })
      return
    }
    if (path.endsWith('/api/session/stop')) {
      controls.stoppedSessionIds.add((request.postDataJSON() as { id: string }).id)
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' })
  })
}

test('pairs a browser, respects permissions, and adapts to a phone screen', async () => {
  test.setTimeout(60_000)
  const { server, url } = await startStaticServer()
  let browser: Browser | undefined
  const controls: MockControls = { paired: false, canControl: false, writes: [], writeTimes: [], inputAttempts: [], inputFailures: 0, inputDelayMs: 0, resizes: [], sessions: [], stoppedSessionIds: new Set(), outputConnections: 0, closeFirstOutput: false, terminalEnded: false }
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
    await installApiMocks(page, controls)
    await page.goto(url)

    await expect(page.getByRole('heading', { name: /Dawsha/i })).toBeVisible()
    await expect(page.locator('#remote-beta-badge')).toHaveText('BETA')
    await expect(page.locator('#pair-view')).toBeVisible()
    await page.locator('#pairing-code').fill('123456')
    await page.locator('#device-name').fill('Test phone')
    await page.locator('#pair-submit').click()

    await expect(page.locator('#workspace-view')).toBeVisible()
    await expect(page.locator('#active-sessions')).toContainText('Sample project')
    await expect(page.locator('#sessions-view')).toBeVisible()
    await expect(page.locator('#active-sessions')).toContainText('Sample project')
    await page.screenshot({ path: 'test-results/screens/remote-control-desktop.png' })
    await page.locator('.running-card').click()
    await expect(page.locator('#terminal')).toBeVisible()
    await expect(page.locator('#terminal-compose')).toHaveCount(0)
    await expect(page.locator('#terminal-session-list .terminal-session-option')).toHaveCount(1)
    await expect(page.locator('#terminal-session-terminal-1')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#terminal-readonly')).toBeVisible()
    await expect(page.locator('#terminal-dimensions')).toHaveText(/\d+ × \d+/)
    const terminalTypography = await page.locator('#terminal .xterm-rows').evaluate((element) => {
      const style = getComputedStyle(element)
      return { family: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight }
    })
    expect(terminalTypography.family).toContain('JetBrains Mono')
    expect(terminalTypography.family).not.toContain('var(')
    expect(terminalTypography.size).toBe('15px')
    await expect(page.locator('#terminal-stream-status')).toHaveClass(/connected/)
    const selectedSession = page.locator('.terminal-session-option[aria-pressed="true"]')
    await selectedSession.focus()
    await page.waitForTimeout(5_500)
    await expect(selectedSession).toBeFocused()
    await expect(page.locator('#terminal-stream-status')).toHaveAttribute('aria-live', 'polite')
    await page.waitForTimeout(200)
    expect(controls.resizes).toEqual([])
    await expect(page.locator('.xterm-rows')).toContainText('Remote session ready')
    const redMarker = page.locator('.xterm-rows span').filter({ hasText: 'ANSI red marker' }).first()
    await expect(redMarker).toHaveCSS('color', 'rgb(248, 113, 113)')
    const greenMarker = page.locator('.xterm-rows span').filter({ hasText: 'ANSI green marker' }).first()
    await expect(greenMarker).toHaveCSS('color', 'rgb(52, 211, 153)')
    const yellowMarker = page.locator('.xterm-rows span').filter({ hasText: 'ANSI yellow marker' }).first()
    await expect(yellowMarker).toHaveCSS('color', 'rgb(245, 181, 74)')
    const blueMarker = page.locator('.xterm-rows span').filter({ hasText: 'ANSI blue marker' }).first()
    await expect(blueMarker).toHaveCSS('color', 'rgb(96, 165, 250)')
    const rowTexts = await page.locator('.xterm-rows > div').allTextContents()
    const wrappedLine = rowTexts.find((text) => text.includes('line after bare LF'))
    expect(wrappedLine, JSON.stringify(rowTexts)).toBeDefined()
    expect(wrappedLine!.length, 'bare LF should move the cursor down without a carriage return, indenting the next line').toBeGreaterThan('line after bare LF'.length)
    const terminalWorkspace = page.locator('.terminal-workspace')
    await expect(terminalWorkspace).toHaveCSS('border-radius', '14px')
    await page.setViewportSize({ width: 1800, height: 850 })
    expect(controls.resizes).toEqual([])
    await page.screenshot({ path: 'test-results/screens/remote-control-terminal-wide.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    const terminalMobileLayout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))
    expect(terminalMobileLayout.width).toBeLessThanOrEqual(terminalMobileLayout.viewport)
    await expect(page.locator('#terminal-stream-status')).toBeVisible()
    const streamLabelBox = await page.locator('#terminal-stream-label').boundingBox()
    expect(streamLabelBox?.width, 'status text must stay visible (not hidden via font-size:0) for accessibility at 390px').toBeGreaterThan(0)
    await expect(page.locator('#terminal-connection')).toBeVisible()
    const sessionChipBox = await page.locator('.terminal-session-option').first().boundingBox()
    expect(sessionChipBox?.height, 'session selector chips should meet the 44px touch target minimum').toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: 'test-results/screens/remote-control-terminal-mobile.png' })
    await page.setViewportSize({ width: 1280, height: 850 })
    await expect(page.locator('#remote-new-session')).toBeHidden()
    await expect(page.locator('#remote-nav-sessions')).toBeVisible()
    await expect(page.locator('#remote-nav-projects')).toBeVisible()
    await expect(page.locator('.session-nav-button')).toHaveCount(0)

    controls.canControl = true
    await page.reload()
    await expect(page.locator('#sessions-view')).toBeVisible()
    await page.locator('#remote-nav-sessions').click()
    await page.locator('.running-card').click()
    await page.setViewportSize({ width: 1280, height: 851 })
    await expect(page.locator('#terminal-compose')).toBeVisible()
    await page.waitForTimeout(300)
    expect(controls.resizes, 'a browser that can type must still leave the desktop PTY size alone').toEqual([])
    controls.closeFirstOutput = true
    controls.outputConnections = 0
    await page.reload()
    await page.locator('#remote-nav-sessions').click()
    await page.locator('.running-card').click()
    await expect(page.locator('#terminal-compose')).toBeVisible()
    await expect.poll(() => controls.outputConnections, { timeout: 7000 }).toBeGreaterThanOrEqual(2)
    await page.locator('#terminal-input').fill('draft survives refresh')
    await page.waitForTimeout(5200)
    await expect(page.locator('#terminal-input')).toHaveValue('draft survives refresh')
    await expect(page.locator('#terminal-input')).toBeFocused()
    const composerInput = page.locator('#terminal-input')
    const composerStatus = page.locator('#terminal-compose-status')

    // A failed send must keep the draft and explain what happened.
    controls.inputFailures = 1
    await composerInput.fill('echo hi')
    await page.locator('#terminal-send').click()
    await expect(composerStatus).toContainText(/not sent/i)
    await expect(composerStatus).toContainText('Cloudflare Quick Tunnel is not ready.')
    await expect(composerInput).toHaveValue('echo hi')
    expect(controls.writes).toEqual([])
    await page.waitForTimeout(5200)
    await expect(composerStatus).toContainText(/not sent/i)

    // Retrying types the command, then sends Enter separately so agent TUIs do not treat it as a paste.
    await page.locator('#terminal-send').click()
    await expect.poll(() => controls.writes).toEqual(['echo hi', '\r'])
    expect(controls.writeTimes[1] - controls.writeTimes[0], 'Enter must arrive after the text, not in the same burst').toBeGreaterThanOrEqual(150)
    await expect(composerInput).toHaveValue('')
    await expect(composerStatus).not.toContainText(/not sent/i)

    // Enter submits from the keyboard; repeated submits while a send is in flight do not duplicate it.
    controls.writes.length = 0
    controls.inputAttempts.length = 0
    controls.inputDelayMs = 400
    await composerInput.fill('ls')
    await composerInput.press('Enter')
    await composerInput.press('Enter')
    await page.locator('#terminal-send').click({ force: true })
    await expect.poll(() => controls.writes).toEqual(['ls', '\r'])
    await page.waitForTimeout(600)
    expect(controls.inputAttempts).toEqual(['ls', '\r'])
    await expect(composerInput).toHaveValue('')
    controls.inputDelayMs = 0

    // Shift+Enter inserts a newline instead of sending.
    await composerInput.press('Shift+Enter')
    await expect(composerInput).toHaveValue('\n')
    await composerInput.fill('')

    // Terminal keys that phones cannot type are one tap away.
    controls.writes.length = 0
    await page.locator('[data-terminal-key="escape"]').click()
    await page.locator('[data-terminal-key="up"]').click()
    await expect.poll(() => controls.writes).toEqual(['\u001b', '\u001b[A'])

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(composerInput).toBeVisible()
    await expect(composerInput).toBeInViewport()
    const sendBox = await page.locator('#terminal-send').boundingBox()
    expect(sendBox?.height, 'send button should meet the 44px touch target minimum').toBeGreaterThanOrEqual(44)
    const keyBox = await page.locator('[data-terminal-key="escape"]').boundingBox()
    expect(keyBox?.height, 'terminal keys should meet the 44px touch target minimum').toBeGreaterThanOrEqual(44)
    expect(await composerInput.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)), 'inputs under 16px zoom the page on iOS').toBeGreaterThanOrEqual(16)
    const composerOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(composerOverflow).toBeLessThanOrEqual(0)
    await page.screenshot({ path: 'test-results/screens/remote-control-composer-mobile.png' })
    await page.setViewportSize({ width: 1280, height: 850 })

    await page.locator('#remote-nav-projects').click()
    await expect(page.locator('#project-card-project-1')).toBeVisible()
    await page.locator('#project-start-project-1').click()
    await expect(page.locator('#new-session-dialog')).toBeVisible()
    await expect(page.locator('#new-session-project')).toHaveValue('project-1')
    await page.locator('#new-session-agent').selectOption('claude')
    await page.locator('#new-session-submit').click()
    await expect.poll(() => controls.sessions).toHaveLength(1)
    expect(controls.sessions[0]).toMatchObject({ projectId: 'project-1', agent: 'claude', cols: expect.any(Number), rows: expect.any(Number) })
    await expect(page.locator('#terminal-title')).toContainText('Claude')
    await expect(page.locator('#terminal-stop-session')).toBeVisible()
    await page.locator('#terminal-stop-session').click()
    await expect.poll(() => controls.stoppedSessionIds.has('terminal-2')).toBe(true)

    await page.locator('#remote-nav-sessions').click()
    await page.locator('[data-resume-session="session-gemini"]').click()
    await expect.poll(() => controls.sessions).toHaveLength(2)
    expect(controls.sessions[1]).toMatchObject({ projectId: 'project-1', agent: 'gemini', sessionId: 'session-gemini', cols: expect.any(Number), rows: expect.any(Number) })
    await expect(page.locator('#terminal-title')).toContainText('Gemini')
    controls.terminalEnded = true
    await expect(page.locator('#terminal-empty')).toContainText('This session is no longer active', { timeout: 7000 })
    await expect(page.getByRole('button', { name: 'Back to sessions' })).toBeVisible()

    await page.locator('#remote-nav-sessions').click()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('#remote-nav-sessions')).toBeVisible()
    await expect(page.locator('#remote-new-session')).toBeVisible()
    const mobileLayout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      overflow: [...document.querySelectorAll<HTMLElement>('body *')]
        .map((element) => ({ id: element.id, className: typeof element.className === 'string' ? element.className : '', right: Math.round(element.getBoundingClientRect().right) }))
        .filter((element) => element.right > window.innerWidth + 1)
        .slice(0, 8)
    }))
    expect(mobileLayout.width, JSON.stringify(mobileLayout)).toBeLessThanOrEqual(mobileLayout.viewport)
    await page.screenshot({ path: 'test-results/screens/remote-control-mobile.png' })

    // Disconnect goes back to pairing with an empty code box; the used code works only once.
    await page.locator('#remote-logout').click()
    await expect(page.locator('#pair-view')).toBeVisible()
    await expect(page.locator('#pairing-code')).toHaveValue('')
  } finally {
    await browser?.close()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
})

test('phone touch clients can send through the mobile composer', async () => {
  test.setTimeout(20_000)
  const { server, url } = await startStaticServer()
  let browser: Browser | undefined
  const controls: MockControls = { paired: true, canControl: true, writes: [], writeTimes: [], inputAttempts: [], inputFailures: 0, inputDelayMs: 0, resizes: [], sessions: [], stoppedSessionIds: new Set(), outputConnections: 0, closeFirstOutput: false, terminalEnded: false }
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await installApiMocks(page, controls)
    await page.goto(url)
    await expect(page.locator('#sessions-view')).toBeVisible()
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    await page.locator('.running-card').click()
    await expect(page.locator('#terminal-compose')).toBeVisible()
    await expect(page.locator('#terminal-input')).toBeInViewport()
    await page.locator('#terminal-input').fill('pwd')
    await page.locator('#terminal-send').click()
    await expect.poll(() => controls.writes).toEqual(['pwd', '\r'])
    await expect(page.locator('#terminal-input')).toHaveValue('')
    await page.locator('[data-terminal-key="escape"]').click()
    await page.locator('[data-terminal-key="enter"]').click()
    await expect.poll(() => controls.writes).toEqual(['pwd', '\r', '\u001b', '\r'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  } finally {
    await browser?.close()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
})

test('draws agent output at the PTY size and never resizes the desktop PTY, even when it can type', async () => {
  test.setTimeout(30_000)
  const { server, url } = await startStaticServer()
  let browser: Browser | undefined
  const controls: MockControls = { paired: true, canControl: false, writes: [], writeTimes: [], inputAttempts: [], inputFailures: 0, inputDelayMs: 0, resizes: [], sessions: [], stoppedSessionIds: new Set(), outputConnections: 0, closeFirstOutput: false, terminalEnded: false, snapshotSize: { cols: 120, rows: 40 } }
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await installApiMocks(page, controls)
    await page.goto(url)
    await page.locator('.running-card').click()
    await expect(page.locator('.xterm-rows')).toContainText('Remote session ready')

    // Read only: mirror the desktop's 120 columns and scroll sideways instead of rewrapping the TUI.
    await expect(page.locator('#terminal-dimensions')).toHaveText('120 × 40')
    await expect(page.locator('#terminal')).toHaveClass(/pty-sized/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    await page.waitForTimeout(300)
    expect(controls.resizes).toEqual([])

    // Input enabled: still mirror the desktop size. Resizing the PTY to the phone made the agent
    // redraw for ~40 columns and garbled the desktop pane.
    controls.canControl = true
    await page.reload()
    await page.locator('.running-card').click()
    await expect(page.locator('.xterm-rows')).toContainText('Remote session ready')
    await expect(page.locator('#terminal-dimensions')).toHaveText('120 × 40')
    await page.waitForTimeout(500)
    expect(controls.resizes, 'a browser must never resize the desktop PTY').toEqual([])

    // When the desktop pane changes size, the phone follows it.
    controls.outputSocket!.send(JSON.stringify({ event: 'resize', data: { cols: 100, rows: 30 } }))
    await expect(page.locator('#terminal-dimensions')).toHaveText('100 × 30')
    expect(controls.resizes).toEqual([])
  } finally {
    await browser?.close()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
})

test('public build exposes beta Remote Access settings and stays off until configured', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.locator('#settings-button').click()
    await expect(page.locator('#settings-tab-remote')).toBeVisible()
    await page.locator('#settings-tab-remote').click()
    await expect(page.locator('#remote-settings-beta')).toHaveText('BETA')
    await expect(page.locator('#remote-access-toggle')).toBeEnabled()
    await expect(page.getByText(/pairing code is the only login gate/i)).toBeVisible()
    await expect(page.locator('.remote-status-off')).toContainText('off')
  } finally {
    await closeApp(app)
  }
})

test('a scanned QR link pairs the phone without typing and clears the code from the address bar', async () => {
  const { server, url } = await startStaticServer()
  let browser: Browser | undefined
  const controls: MockControls = { paired: false, canControl: false, writes: [], writeTimes: [], inputAttempts: [], inputFailures: 0, inputDelayMs: 0, resizes: [], sessions: [], stoppedSessionIds: new Set(), outputConnections: 0, closeFirstOutput: false, terminalEnded: false, pairBodies: [] }
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    })
    await installApiMocks(page, controls)
    await page.goto(`${url}#pair=654321`)
    await expect(page.locator('#workspace-view')).toBeVisible()
    expect(controls.pairBodies).toEqual([{ code: '654321', deviceName: 'iPhone · Safari' }])
    expect(new URL(page.url()).hash).toBe('')
  } finally {
    await browser?.close()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
})

test('Remote Access settings show a QR code that opens the page with the pairing code', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    const url = 'https://quiet-river-1234.trycloudflare.com/dawsha/'
    await app.evaluate(({ ipcMain }, tunnel) => {
      const state = () => ({
        status: 'available',
        enabled: true,
        url: tunnel,
        message: 'Remote Access is on.',
        notice: null,
        devices: [],
        pairing: { code: '482913', expiresAt: Date.now() + 5 * 60_000 },
        permissions: { allowedEmail: '', terminalInput: true, sessionControl: true }
      })
      ipcMain.removeHandler('remote-access:get')
      ipcMain.handle('remote-access:get', () => state())
      ipcMain.removeHandler('remote-access:verify')
      ipcMain.handle('remote-access:verify', () => ({ ok: true, state: state() }))
    }, url)
    // Settings reads the Remote Access state once at startup.
    await page.reload()
    await page.locator('#settings-button').click()
    await page.locator('#settings-tab-remote').click()
    const qr = page.locator('.remote-qr')
    await expect(qr).toBeVisible()
    await expect(qr).toHaveAttribute('data-qr', `${url}#pair=482913`)
    await expect(qr.locator('svg[role="img"]')).toHaveAttribute('aria-label', /pairs your phone/)
    await expect(page.locator('.remote-qr-card')).toContainText('Scan with your phone')
    await expect(page.locator('.remote-manual')).toContainText('Or connect by hand')
    await expect(page.locator('.remote-pairing-code')).toHaveAttribute('aria-label', 'Pairing code 4 8 2 9 1 3')
    await expect(page.getByRole('textbox', { name: 'Cloudflare PIN email' })).toBeVisible()
    await page.screenshot({ path: 'test-results/screens/remote-access-qr.png' })
  } finally {
    await closeApp(app)
  }
})

test('Remote Access never shows the stale link after the tunnel dies: it reconnects and asks to re-scan', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    const oldUrl = 'https://old-river-1234.trycloudflare.com/dawsha/'
    const newUrl = 'https://new-river-5678.trycloudflare.com/dawsha/'
    await app.evaluate(({ ipcMain }, urls) => {
      let phase: 'old' | 'reconnecting' | 'new' = 'old'
      const base = { enabled: true, devices: [], permissions: { allowedEmail: '', terminalInput: true, sessionControl: true } }
      const state = () => phase === 'old'
        ? { ...base, status: 'available', url: urls.old, message: 'Remote Access is on.', notice: null, pairing: { code: '111111', expiresAt: Date.now() + 5 * 60_000 } }
        : phase === 'reconnecting'
          ? { ...base, status: 'reconnecting', url: null, message: 'The connection dropped. Reconnecting…', notice: null, pairing: null }
          : { ...base, status: 'available', url: urls.next, message: 'Remote Access is on.', notice: 'The address changed. Scan the new code on your phone.', pairing: { code: '222222', expiresAt: Date.now() + 5 * 60_000 } }
      ipcMain.removeHandler('remote-access:get')
      ipcMain.handle('remote-access:get', () => state())
      ipcMain.removeHandler('remote-access:verify')
      ipcMain.handle('remote-access:verify', async () => {
        // The tunnel is dead: main detects it, starts reconnecting, and only later has a new address.
        phase = 'reconnecting'
        setTimeout(() => { phase = 'new' }, 1500)
        return { ok: true, state: state() }
      })
    }, { old: oldUrl, next: newUrl })
    await page.reload()
    await page.locator('#settings-button').click()
    await page.locator('#settings-tab-remote').click()
    await expect(page.locator('.remote-status')).toContainText('Reconnecting…')
    await expect(page.locator('.remote-qr')).toHaveCount(0)
    await expect(page.locator('.remote-url')).toHaveCount(0)
    await expect(page.locator('.remote-qr')).toHaveAttribute('data-qr', /new-river-5678.*#pair=222222/, { timeout: 15_000 })
    await expect(page.locator('.remote-url')).toHaveText(newUrl)
    await expect(page.locator('#remote-address-changed')).toHaveText('The address changed. Scan the new code on your phone.')
    await expect(page.getByText('old-river-1234')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

interface FakeApproval { allowBlock: string | null; id: string; projectId: string; projectName: string; agent: string; title: string; text: string; kind: string; summary: string; fingerprint: string; since: number; restriction: string | null; canAllow: boolean }

const approvalCard = (id: string, overrides: Partial<FakeApproval> = {}): FakeApproval => ({
  id,
  projectId: 'project-1',
  projectName: 'billing-api',
  agent: 'codex',
  title: 'Codex needs you',
  text: 'Bash command\n  npm test\nDo you want to proceed?\n1. Yes\n2. No',
  kind: 'command',
  summary: 'npm test',
  fingerprint: '0123456789abcdef',
  since: Date.now() - 60_000,
  restriction: null,
  allowBlock: null,
  canAllow: true,
  ...overrides
})

async function installApprovalMocks(page: Page, pending: FakeApproval[], answers: unknown[]): Promise<{ history: unknown[]; pushed: () => void }> {
  const history: unknown[] = []
  let socket: WebSocketRoute | undefined
  const payload = () => ({ items: pending, history, notify: false })
  await page.routeWebSocket('**/api/approvals/stream*', (route) => {
    socket = route
    route.send(JSON.stringify({ event: 'approvals', data: payload() }))
  })
  await page.route('**/dawsha/api/approvals**', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload()) })
      return
    }
    const body = request.postDataJSON() as { id: string; allow: boolean; reason?: string }
    answers.push(body)
    const index = pending.findIndex((item) => item.id === body.id)
    if (index < 0) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"That prompt changed or was already answered."}' })
      return
    }
    history.unshift({ id: String(history.length + 1), time: Date.now(), allowed: body.allow, summary: pending[index].summary, kind: pending[index].kind, agent: 'codex', projectName: 'billing-api', source: 'phone', device: 'Test phone', reason: Boolean(body.reason) })
    pending.splice(index, 1)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reasonSent: Boolean(body.reason) }) })
    socket?.send(JSON.stringify({ event: 'approvals', data: payload() }))
  })
  return { history, pushed: () => socket?.send(JSON.stringify({ event: 'approvals', data: payload() })) }
}

test('phone approvals: list, allow, deny with a reason, and a restricted edit that cannot be allowed', async () => {
  test.setTimeout(60_000)
  const { server, url } = await startStaticServer()
  let browser: Browser | undefined
  const controls: MockControls = { paired: true, canControl: false, approvals: true, writes: [], writeTimes: [], inputAttempts: [], inputFailures: 0, inputDelayMs: 0, resizes: [], sessions: [], stoppedSessionIds: new Set(), outputConnections: 0, closeFirstOutput: false, terminalEnded: false }
  const pending = [
    approvalCard('terminal-1'),
    approvalCard('terminal-2', { agent: 'claude', title: 'Claude needs you', projectName: 'mobile-shell', kind: 'edit', summary: 'Edit .github/workflows/ci.yml', text: 'Edit file\n.github/workflows/ci.yml\n 15 +   timeout-minutes: 20', fingerprint: 'fedcba9876543210', restriction: 'config', allowBlock: 'config', canAllow: false }),
    approvalCard('terminal-3', { fingerprint: '1111222233334444', summary: 'npm run build' })
  ]
  const answers: Array<{ id: string; allow: boolean; reason?: string }> = []
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await installApiMocks(page, controls)
    const mocks = await installApprovalMocks(page, pending, answers)
    await page.goto(url)
    await expect(page.locator('#approvals-badge')).toHaveText('3')
    await page.locator('#remote-nav-approvals').click()
    await expect(page.locator('#approvals-view')).toBeVisible()
    await expect(page.locator('.approval-card')).toHaveCount(3)
    await expect(page.locator('.approval-card').first()).toContainText('Codex')
    await expect(page.locator('.approval-card').first()).toContainText('billing-api')
    await expect(page.locator('.approval-card').first()).toContainText('npm test')
    await expect(page.locator('.approval-card').nth(1)).toContainText('Open in Dawsha to allow')
    await expect(page.locator('.approval-card').nth(1).getByRole('button', { name: 'Allow once' })).toHaveCount(0)
    const allowBox = await page.locator('.approval-card').first().getByRole('button', { name: 'Allow once' }).boundingBox()
    expect(allowBox?.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    await expect(page.locator('.approval-card').first()).toContainText('Commands run with your user')
    await page.locator('.approval-card').first().evaluate((element) => { element.setAttribute('data-keep', 'yes') })
    mocks.pushed()
    await page.waitForTimeout(200)
    await expect(page.locator('.approval-card[data-keep="yes"]')).toHaveCount(1)
    await page.screenshot({ path: 'test-results/screens/remote-approvals.png' })

    await page.locator('.approval-card').first().getByRole('button', { name: 'Allow once' }).click()
    await expect.poll(() => answers).toEqual([{ id: 'terminal-1', fingerprint: '0123456789abcdef', allow: true }])
    await expect(page.locator('.approval-card')).toHaveCount(2)
    await expect(page.locator('#approvals-badge')).toHaveText('2')
    await expect(page.locator('.history-row').first()).toContainText('Allowed')

    await page.locator('.approval-card').nth(1).getByRole('button', { name: 'Deny…' }).click()
    await expect(page.locator('#deny-dialog')).toBeVisible()
    await expect(page.locator('.quick-reason')).toHaveText(['Stop and wait for me', 'Don\u2019t run anything, just explain', 'Use a different approach'])
    expect(((await page.locator('.quick-reason').first().boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: 'test-results/screens/remote-approvals-deny.png' })
    await page.locator('.quick-reason').nth(2).click()
    await expect(page.locator('#deny-message')).toHaveValue('Use a different approach')
    await page.locator('#deny-submit').click()
    await expect.poll(() => answers.at(-1)).toEqual({ id: 'terminal-3', fingerprint: '1111222233334444', allow: false, reason: 'Use a different approach' })
    await expect(page.locator('.approval-card')).toHaveCount(1)

    await page.locator('.approval-card').first().getByRole('button', { name: 'Deny…' }).click()
    await page.locator('#deny-submit').click()
    await expect.poll(() => answers.at(-1)).toEqual({ id: 'terminal-2', fingerprint: 'fedcba9876543210', allow: false })
    await expect(page.locator('#approvals-root .quiet-empty')).toContainText('Nothing is waiting for you')
    await expect(page.locator('#approvals-badge')).toBeHidden()
    await expect(page.locator('.history-row')).toHaveCount(3)
  } finally {
    await browser?.close()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
})

test('phone approvals: a prompt that already changed is refused with a clear message', async () => {
  const { server, url } = await startStaticServer()
  let browser: Browser | undefined
  const controls: MockControls = { paired: true, canControl: false, approvals: true, writes: [], writeTimes: [], inputAttempts: [], inputFailures: 0, inputDelayMs: 0, resizes: [], sessions: [], stoppedSessionIds: new Set(), outputConnections: 0, closeFirstOutput: false, terminalEnded: false }
  const pending = [approvalCard('terminal-1')]
  const answers: unknown[] = []
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await installApiMocks(page, controls)
    await installApprovalMocks(page, pending, answers)
    await page.goto(url)
    await page.locator('#remote-nav-approvals').click()
    await expect(page.locator('.approval-card')).toHaveCount(1)
    pending.splice(0, 1)
    await page.locator('.approval-card').getByRole('button', { name: 'Allow once' }).click()
    await expect(page.locator('#approvals-root .remote-notice')).toContainText('changed or was already answered')
  } finally {
    await browser?.close()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
})

test('phone approvals: a disabled permission shows a clear off state and no prompts', async () => {
  const { server, url } = await startStaticServer()
  let browser: Browser | undefined
  const controls: MockControls = { paired: true, canControl: true, approvals: false, writes: [], writeTimes: [], inputAttempts: [], inputFailures: 0, inputDelayMs: 0, resizes: [], sessions: [], stoppedSessionIds: new Set(), outputConnections: 0, closeFirstOutput: false, terminalEnded: false }
  const approvalRequests: string[] = []
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await installApiMocks(page, controls)
    await page.route('**/dawsha/api/approvals**', async (route) => {
      approvalRequests.push(route.request().url())
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Answering permission prompts is turned off in Dawsha settings."}' })
    })
    await page.goto(url)
    await page.locator('#remote-nav-approvals').click()
    await expect(page.locator('#approvals-root')).toContainText('Approvals are off')
    await expect(page.locator('.approval-card')).toHaveCount(0)
    await expect(page.locator('#approvals-badge')).toBeHidden()
    expect(approvalRequests).toEqual([])
    const refused = await page.evaluate(async () => (await fetch('./api/approvals', { credentials: 'same-origin' })).status)
    expect(refused).toBe(403)
  } finally {
    await browser?.close()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
})

test('desktop settings: phone approvals are off by default and each setting persists through the main process', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.locator('#settings-button').click()
    await page.locator('#settings-tab-remote').click()
    const approvals = page.locator('#remote-approvals')
    await expect(approvals).not.toBeChecked()
    await expect(page.locator('#remote-approvals-notify')).toBeDisabled()
    await expect(page.locator('#remote-approvals-config')).toBeDisabled()
    await approvals.check()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Allow phone approvals' }).click()
    await expect(approvals).toBeChecked()
    await expect(page.locator('#remote-approvals-notify')).toBeEnabled()
    await expect(page.locator('#remote-approvals-config')).not.toBeChecked()
    await page.locator('#remote-approvals-away').check()
    await expect(page.locator('#remote-approvals-minutes')).toBeEnabled()
    await page.locator('#remote-approvals-minutes').fill('7')
    await page.locator('#remote-approvals-minutes').blur()
    await page.locator('#remote-approvals-config').check()
    const stored = await page.evaluate(async () => (await window.gridApi.remoteAccess!.getState()).permissions)
    expect(stored).toMatchObject({ approvals: true, approvalsOnlyWhenAway: true, approvalsAwayMinutes: 7, approvalsAllowConfigEdits: true, terminalInput: false, sessionControl: false })
    await page.screenshot({ path: 'test-results/screens/remote-approvals-settings.png' })
  } finally {
    await closeApp(app)
  }
})
