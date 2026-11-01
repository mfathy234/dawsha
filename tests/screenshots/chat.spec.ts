import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { activeTermId, closeApp, createSandbox, feedTerminal, launchApp, type Sandbox } from '../e2e/helpers'

const AGENT = resolve(__dirname, '../support/chatAgent.cjs')
const SESSION = '5b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'
const OUT = process.env.DAWSHA_SHOTS_OUT ?? resolve(__dirname, '../../test-results/chat-shots')
const PERMISSION = ['  npm install --save-dev @testing-library/user-event', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')
const MENU = [' Select model', ' ❯ 1. Default (recommended) ✔', '   2. Sonnet', '   3. Haiku', '', ' Enter to confirm · Esc to exit', ''].join('\r\n')

const logPath = (sandbox: Sandbox): string => join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'), `${SESSION}.jsonl`)
const line = (record: unknown): string => JSON.stringify(record) + '\n'
const text = (uuid: string, body: string) => ({ type: 'assistant', uuid, message: { content: [{ type: 'text', text: body }] } })
const tool = (uuid: string, id: string, name: string, input: unknown) => ({ type: 'assistant', uuid, message: { content: [{ type: 'tool_use', id, name, input }] } })
const result = (uuid: string, id: string, content: string) => ({ type: 'user', uuid, message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } })

const english = [
  { type: 'user', uuid: 'u1', message: { content: 'Add a dark mode toggle and keep the choice in localStorage.' } },
  text('a1', "I'll add a `ThemeToggle` to Settings and store the choice in `localStorage`."),
  tool('a2', 't1', 'Edit', { file_path: 'src/context/theme.tsx', old_string: "const [theme] = useState('light')", new_string: "export type Theme = 'light' | 'dark'\nconst THEME_KEY = 'acme.theme'" }),
  result('u2', 't1', 'ok'),
  tool('a3', 't2', 'Edit', { file_path: 'src/components/Settings.tsx', old_string: 'a', new_string: '<ThemeToggle />' }),
  result('u3', 't2', 'ok'),
  tool('a4', 't3', 'Write', { file_path: 'src/components/ThemeToggle.tsx', content: 'export function ThemeToggle() {\n  return null\n}\n' }),
  result('u4', 't3', 'ok')
]
const finished = [
  tool('a5', 't4', 'Bash', { command: 'npm test -- theme' }),
  result('u5', 't4', ' PASS  src/context/theme.test.tsx\n Tests  41 passed (41)'),
  text('a6', 'Done. The toggle is in Settings and the choice survives a reload. All 41 tests pass.')
]
const arabic = [
  { type: 'user', uuid: 'u1', message: { content: 'ضيف زرار للوضع الداكن واحفظ الاختيار في localStorage.' } },
  text('a1', 'أضفت الزرار في صفحة الإعدادات، والاختيار بيتحفظ في `localStorage` وكل الاختبارات نجحت.'),
  tool('a2', 't1', 'Edit', { file_path: 'src/context/theme.tsx', old_string: 'a', new_string: 'b\nc' }),
  result('u2', 't1', 'ok'),
  tool('a3', 't2', 'Edit', { file_path: 'src/components/Settings.tsx', old_string: 'a', new_string: 'b' }),
  result('u3', 't2', 'ok')
]
const limit = {
  type: 'assistant',
  uuid: 'l1',
  apiError: 'usage_limit_reached',
  apiErrorParams: { rate_limit_info: { status: 'rejected', resetsAt: 1791907200 } },
  message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your 5 hour limit. It resets at 23:40." }] }
}

function env(sandbox: Sandbox): Record<string, string> {
  const node = process.execPath
  return { CHAT_LOG: logPath(sandbox), DAWSHA_CLAUDE_COMMAND: node, DAWSHA_CLAUDE_ARGS: JSON.stringify([AGENT, 'claude']) }
}

function setLog(sandbox: Sandbox, records: unknown[]): void {
  mkdirSync(join(logPath(sandbox), '..'), { recursive: true })
  writeFileSync(logPath(sandbox), records.map(line).join(''))
}

function setSession(sandbox: Sandbox, status: 'busy' | 'idle'): void {
  const now = Date.now()
  writeFileSync(join(sandbox.sessionsDir, `${SESSION}.json`), JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, name: 'Dark mode toggle', nameSource: 'user', status, startedAt: now + 1000, updatedAt: now + 1000 }), 'utf8')
}

function chatDefault(sandbox: Sandbox): void {
  const path = join(sandbox.userData, 'settings.json')
  const settings = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, JSON.stringify({ ...settings, sessionView: 'chat' }), 'utf8')
}

async function shot(target: Locator | Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  await target.screenshot({ path: join(OUT, `${name}.png`) })
}

async function settle(pane: Locator): Promise<void> {
  await expect(pane.locator('.chat')).toBeVisible()
  await pane.page().waitForTimeout(700)
}

test('every chat state at the CI window size', async () => {
  const sandbox = createSandbox()
  chatDefault(sandbox)
  const { app, page } = await launchApp(sandbox, env(sandbox))
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const pane = page.locator('.pane').first()
    await expect(pane).toBeVisible({ timeout: 20_000 })
    const termId = await activeTermId(page)
    await settle(pane)
    await shot(pane, '01-new-session')

    setLog(sandbox, english)
    setSession(sandbox, 'busy')
    await expect(pane.locator('.chat-working')).toBeVisible({ timeout: 15_000 })
    await settle(pane)
    await shot(pane, '02-working')
    await pane.locator('.chat-tool').first().click()
    await shot(pane, '03-tool-open')
    await pane.locator('.chat-tool').first().click()

    await feedTerminal(page, termId, '\r\n' + PERMISSION)
    await expect(pane.locator('.chat .pane-permission')).toBeVisible({ timeout: 15_000 })
    await shot(pane, '04-needs-approval')
    await feedTerminal(page, termId, '\x1b[2J\x1b[H')
    await expect(pane.locator('.chat .pane-permission')).toHaveCount(0, { timeout: 15_000 })

    setSession(sandbox, 'idle')
    appendFileSync(logPath(sandbox), finished.map(line).join(''))
    await expect(pane.locator('.chat-say').last()).toContainText('Done.', { timeout: 15_000 })
    await settle(pane)
    await shot(pane, '05-done')

    appendFileSync(logPath(sandbox), line(limit))
    await expect(pane.locator('.chat-notice')).toContainText('hit your 5 hour limit', { timeout: 15_000 })
    await shot(pane, '06-limit-reached')

    setLog(sandbox, english)
    await feedTerminal(page, termId, MENU)
    await expect(pane.locator('.chat-notice')).toContainText("can't show", { timeout: 15_000 })
    await shot(pane, '07-needs-terminal')
    await feedTerminal(page, termId, '\x1b[2J\x1b[H')

    setLog(sandbox, arabic)
    await expect(pane.locator('.chat-you')).toHaveAttribute('dir', 'rtl', { timeout: 15_000 })
    await settle(pane)
    await shot(pane, '08-arabic')

    setLog(sandbox, Array.from({ length: 8 }, (_, index) => ({ shape: 'v2', index })))
    await expect(pane.getByRole('alert')).toBeVisible({ timeout: 15_000 })
    await shot(pane, '09-reader-failed')

    await pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Terminal' }).click()
    await expect(pane.locator('.term-host.active')).toBeVisible()
    await shot(pane, '10-terminal')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('#settings-tab-general').click()
    await shot(page.locator('.settings-view'), '11-settings')
    await page.locator('#sessions-button').click()
    await page.getByRole('button', { name: 'New session, Ctrl+N' }).click()
    await expect(page.getByRole('dialog', { name: 'New session' })).toBeVisible()
    await shot(page.getByRole('dialog', { name: 'New session' }), '12-new-session-dialog')
  } finally {
    await closeApp(app)
  }
})

test('chat in small grid panes', async () => {
  const sandbox = createSandbox()
  chatDefault(sandbox)
  const { app, page } = await launchApp(sandbox, env(sandbox))
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    setLog(sandbox, [...english, ...finished])
    for (let index = 0; index < 4; index += 1) {
      await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
      await expect(page.locator('.pane')).toHaveCount(index + 1, { timeout: 20_000 })
    }
    setSession(sandbox, 'idle')
    await page.waitForTimeout(1500)
    await shot(page, '20-grid-four-panes')
    const sizes = await page.locator('.pane').evaluateAll((panes) => panes.map((pane) => [Math.round(pane.getBoundingClientRect().width), Math.round(pane.getBoundingClientRect().height)]))
    console.log('pane sizes', JSON.stringify(sizes))
  } finally {
    await closeApp(app)
  }
})
