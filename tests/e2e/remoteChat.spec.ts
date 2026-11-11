import { createServer, type Server } from 'node:http'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'

const renderer = resolve(process.cwd(), process.env.DAWSHA_PRIVATE_REMOTE_BUILD === '1' ? 'out/renderer-private' : 'out/renderer')
const shots = process.env.DAWSHA_SHOTS ?? 'test-results/screens'

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

const CHAT = {
  status: 'ok',
  version: 'claude:live#3',
  earlier: 0,
  items: [
    { k: 'you', id: 'u1', text: 'Write tests for it' },
    { k: 'tool', id: 't1', kind: 'create', verb: 'Created', target: 'retry.test.ts', add: 64, done: true },
    { k: 'tool', id: 't2', kind: 'shell', verb: 'Ran the tests', target: '', done: true },
    { k: 'say', id: 'a1', text: '4 tests pass. <b>Want me</b> to add one for the 4xx case too?' },
    { k: 'sum', id: 'a1:sum', files: 3, add: 14, del: 5 },
    { k: 'you', id: 'u2', text: 'Yes, and then commit' }
  ]
}

interface PhoneMock { terminalInput: boolean; sends: unknown[]; chatCalls: number }

async function installMocks(page: Page, mock: PhoneMock): Promise<void> {
  await page.route('**/dawsha/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const reply = (status: number, body: unknown): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path.endsWith('/api/state')) {
      await reply(200, {
        device: { id: 'device-1', name: 'Test phone' },
        projects: [{ id: 'p1', name: 'Upload retries', defaultAgent: 'claude', sessions: [] }],
        terminals: [{ id: 'terminal-1', projectId: 'p1', agent: 'claude', startedAt: Date.now() - 60_000, cols: 80, rows: 24 }],
        permissions: { read: true, terminalInput: mock.terminalInput, sessionControl: false, approvals: false, fullOutput: false }
      })
      return
    }
    if (path.endsWith('/api/chat/send') && request.method() === 'POST') {
      if (!mock.terminalInput) { await reply(403, { error: 'Sending messages is turned off for phones in Dawsha settings.' }); return }
      mock.sends.push(request.postDataJSON())
      await reply(200, { ok: true })
      return
    }
    if (path.endsWith('/api/chat')) {
      mock.chatCalls += 1
      await reply(200, CHAT)
      return
    }
    await reply(404, { error: 'not found' })
  })
}

async function openChat(browser: Browser, url: string, mock: PhoneMock, scheme: 'dark' | 'light'): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, colorScheme: scheme })
  const page = await context.newPage()
  await installMocks(page, mock)
  await page.goto(url)
  await expect(page.locator('#workspace-view')).toBeVisible()
  await page.locator('#remote-nav-chat').click()
  await expect(page.locator('#chat-view')).toBeVisible()
  return page
}

test('phone Chat tab: the thread, tool rows, the summary and sending with Terminal input', async () => {
  test.setTimeout(90_000)
  const { server, url } = await startStaticServer()
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({ headless: true })
    for (const scheme of ['dark', 'light'] as const) {
      const mock: PhoneMock = { terminalInput: true, sends: [], chatCalls: 0 }
      const page = await openChat(browser, url, mock, scheme)
      await expect(page.getByRole('tab')).toHaveText(['Needs you', 'Agents', 'Sessions', 'Chat', 'Projects'])
      await expect(page.locator('#remote-nav-chat')).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('.ch-you')).toHaveText(['Write tests for it', 'Yes, and then commit'])
      await expect(page.locator('.ch-tool')).toHaveCount(2)
      await expect(page.locator('.ch-tool').first()).toContainText('Created')
      await expect(page.locator('.ch-tool').first()).toContainText('retry.test.ts')
      await expect(page.locator('.ch-tool').first()).toContainText('+64')
      // Text only: markup in a reply is shown as typed, never parsed.
      await expect(page.locator('.ch-say')).toContainText('<b>Want me</b>')
      expect(await page.locator('.ch-say b').count()).toBe(0)
      await expect(page.locator('.ch-sum')).toHaveText('Changed 3 files+14−5')
      await expect(page.locator('.ch-perm')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      const gutters = await page.locator('.ch-comp').evaluate((element) => ({ left: getComputedStyle(element).paddingLeft, right: getComputedStyle(element).paddingRight }))
      expect(gutters).toEqual({ left: '16px', right: '16px' })
      mkdirSync(shots, { recursive: true })
      await page.screenshot({ path: `${shots}/remote-phone-chat-${scheme}.png` })

      await page.locator('.ch-input').fill('Add the 4xx test')
      await page.getByRole('button', { name: 'Send message' }).click()
      await expect.poll(() => mock.sends.length).toBe(1)
      expect(mock.sends[0]).toEqual({ id: 'terminal-1', text: 'Add the 4xx test' })
      await expect(page.locator('.ch-input')).toHaveValue('')
      await page.context().close()
    }
  } finally {
    await browser?.close()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
})

test('phone Chat tab: without Terminal input the box is replaced by the read-only note and nothing is sent', async () => {
  test.setTimeout(60_000)
  const { server, url } = await startStaticServer()
  let browser: Browser | undefined
  try {
    browser = await chromium.launch({ headless: true })
    const mock: PhoneMock = { terminalInput: false, sends: [], chatCalls: 0 }
    const page = await openChat(browser, url, mock, 'dark')
    await expect(page.locator('.ch-say')).toBeVisible()
    await expect(page.locator('.ch-perm')).toHaveText('Read only. Turn on “Terminal input” for this browser in Dawsha\'s Settings › Remote Access to send messages.')
    await expect(page.locator('.ch-input')).toHaveCount(0)
    await expect(page.locator('.ch-send')).toHaveCount(0)
    const refused = await page.evaluate(async () => {
      const response = await fetch('/dawsha/api/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'terminal-1', text: 'hi' }) })
      return response.status
    })
    expect(refused).toBe(403)
    expect(mock.sends).toEqual([])
    mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: `${shots}/remote-phone-chat-readonly.png` })
  } finally {
    await browser?.close()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
})
