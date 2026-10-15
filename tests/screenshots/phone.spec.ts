import { createServer, type Server } from 'node:http'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import { OUT } from './harness'

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

const now = Date.now()

const items = [
  {
    id: 'terminal-1',
    projectId: 'billing-api',
    projectName: 'billing-api',
    agent: 'claude',
    title: 'Claude needs you',
    text: 'Bash command\n  npm test -- invoices\nDo you want to proceed?\n1. Yes\n2. No',
    kind: 'command',
    summary: 'npm test -- invoices',
    fingerprint: '0123456789abcdef',
    since: now - 95_000,
    restriction: null,
    allowBlock: null,
    canAllow: true
  },
  {
    id: 'terminal-2',
    projectId: 'acme-web',
    projectName: 'acme-web',
    agent: 'claude',
    title: 'Claude needs you',
    text: 'Edit file\n.github/workflows/ci.yml\n 15 +   timeout-minutes: 20',
    kind: 'edit',
    summary: 'Edit .github/workflows/ci.yml',
    fingerprint: 'fedcba9876543210',
    since: now - 40_000,
    restriction: 'config',
    allowBlock: 'config',
    canAllow: false
  },
  {
    id: 'terminal-3',
    projectId: 'mobile-shell',
    projectName: 'mobile-shell',
    agent: 'codex',
    title: 'Codex needs you',
    text: 'Bash command\n  npm run build\nDo you want to proceed?\n1. Yes\n2. No',
    kind: 'command',
    summary: 'npm run build',
    fingerprint: '1111222233334444',
    since: now - 20_000,
    restriction: null,
    allowBlock: null,
    canAllow: true
  }
]

const history = [
  { id: 'h1', time: now - 6 * 60_000, allowed: true, summary: 'npm install', kind: 'command', agent: 'claude', projectName: 'docs-site', source: 'phone', device: 'Pixel 9', reason: false },
  { id: 'h2', time: now - 14 * 60_000, allowed: false, summary: 'git push --force', kind: 'command', agent: 'codex', projectName: 'mobile-shell', source: 'phone', device: 'Pixel 9', reason: true }
]

async function mockApi(page: Page): Promise<void> {
  await page.routeWebSocket('**/api/terminal/output*', () => undefined)
  await page.routeWebSocket('**/api/approvals/stream*', (route: WebSocketRoute) => {
    route.send(JSON.stringify({ event: 'approvals', data: { items, history, notify: true } }))
  })
  await page.route('**/dawsha/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/api/state')) {
      const state = {
        device: { id: 'device-1', name: 'Pixel 9' },
        projects: [{ id: 'billing-api', name: 'billing-api', defaultAgent: 'claude', sessions: [] }],
        terminals: [],
        permissions: { read: true, terminalInput: false, sessionControl: false, approvals: true }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) })
      return
    }
    if (path.endsWith('/api/approvals')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, history, notify: true }) })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' })
  })
}

test('generates the phone approvals screenshot from a mocked Remote Control page', async () => {
  mkdirSync(OUT, { recursive: true })
  const { server, url } = await startStaticServer()
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['notifications'] })
    const page = await context.newPage()
    await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'granted' }))
    await mockApi(page)
    await page.goto(url)
    await expect(page.locator('#approvals-badge')).toHaveText('3')
    await page.locator('#remote-nav-approvals').click()
    await expect(page.locator('.approval-card')).toHaveCount(3)
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(OUT, 'remote-approvals.png') })
    await context.close()
  } finally {
    await browser.close()
    await new Promise<void>((done) => server.close(() => done()))
  }
})
