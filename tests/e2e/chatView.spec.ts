import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { activeTermId, bufferText, closeApp, createSandbox, feedTerminal, launchApp, openSettings, type Sandbox } from './helpers'
import { PNG_BASE64 } from '../support/tinyImages'

const AGENT = resolve(__dirname, '../support/chatAgent.cjs')
const SESSION = '5b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'
const PERMISSION = ['  npm install --save-dev vitest', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')
const MENU = [' Select model', ' ❯ 1. Default (recommended) ✔', '   2. Sonnet', '   3. Haiku', '', ' Enter to confirm · Esc to exit', ''].join('\r\n')

const readSettings = (sandbox: Sandbox): any => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))
const logPath = (sandbox: Sandbox): string => join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'), `${SESSION}.jsonl`)
const line = (record: unknown): string => JSON.stringify(record) + '\n'

function agentEnv(sandbox: Sandbox): Record<string, string> {
  const node = process.execPath
  return {
    CHAT_LOG: logPath(sandbox),
    DAWSHA_CLAUDE_COMMAND: node,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([AGENT, 'claude']),
    DAWSHA_CODEX_COMMAND: node,
    DAWSHA_CODEX_ARGS: JSON.stringify([AGENT, 'codex']),
    DAWSHA_GEMINI_COMMAND: node,
    DAWSHA_GEMINI_ARGS: JSON.stringify([AGENT, 'gemini'])
  }
}

function writeLog(sandbox: Sandbox, records: unknown[]): void {
  mkdirSync(join(logPath(sandbox), '..'), { recursive: true })
  writeFileSync(logPath(sandbox), records.map(line).join(''))
}

const seedConversation = [
  { type: 'user', uuid: 'u1', timestamp: '2026-10-13T14:27:56.000Z', message: { role: 'user', content: 'Add a retry to the sender' } },
  { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'I will add a `RetryPolicy` to the sender.' }] } },
  { type: 'assistant', uuid: 'a2', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/sender.ts', old_string: 'a', new_string: 'a\nb' } }] } },
  { type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  { type: 'assistant', uuid: 'a3', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }] } },
  { type: 'user', uuid: 'u3', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'Tests  24 passed (24)' }] } }
]

function writeSession(sandbox: Sandbox, status: 'busy' | 'idle' = 'idle'): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${SESSION}.json`),
    JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, name: 'Retry work', nameSource: 'user', status, startedAt: now + 1000, updatedAt: now + 1000 }),
    'utf8'
  )
}

async function startClaude(page: Page, sandbox: Sandbox, status: 'busy' | 'idle' = 'idle'): Promise<Locator> {
  await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
  await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
  writeSession(sandbox, status)
  return page.locator('.pane').first()
}

const switchTo = (pane: Locator, name: 'Chat' | 'Terminal'): Promise<void> => pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name, exact: true }).click()

test('the header switch swaps Terminal and Chat and the terminal keeps what it showed', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeLog(sandbox, seedConversation)
    const pane = await startClaude(page, sandbox)
    const termId = await activeTermId(page)
    await expect.poll(() => bufferText(page, termId)).toContain('READY claude')
    await feedTerminal(page, termId, 'MARKER-BEFORE-CHAT\r\n')
    await expect(pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true')
    await expect(pane.locator('.chat')).toBeHidden()

    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    await expect(chat).toBeVisible()
    await expect(chat.locator('.chat-you')).toContainText('Add a retry to the sender', { timeout: 15_000 })
    await expect(chat.locator('.chat-say code')).toHaveText('RetryPolicy')
    await expect(chat.locator('.chat-tool')).toHaveCount(2)
    await expect(chat.locator('.chat-tool').first()).toContainText('src/sender.ts')
    await expect(chat.locator('.chat-tool').first().locator('.add')).toHaveText('+2')
    await expect(chat.locator('.chat-tool').nth(1)).toContainText('24 passed')
    await expect(chat.locator('.chat-tool .icon')).toHaveCount(2)
    const gap = await chat.evaluate((el) => (el.querySelector('.chat-composer') as HTMLElement).getBoundingClientRect().top - (el.querySelector('.chat-thread') as HTMLElement).lastElementChild!.getBoundingClientRect().bottom)
    expect(gap).toBeLessThan(40)
    await expect(chat.locator('.chat-toolout')).toHaveCount(0)
    await chat.locator('.chat-tool').nth(1).click()
    await expect(chat.locator('.chat-toolout')).toContainText('Tests  24 passed (24)')
    await chat.locator('.chat-tool').nth(1).click()
    await expect(chat.locator('.chat-toolout')).toHaveCount(0)
    await chat.locator('.chat-tool').first().click()
    await expect(chat.locator('.chat-diff .dl.add')).toHaveCount(2)
    await expect(chat.locator('.chat-diff .dl.del')).toHaveCount(1)
    await chat.locator('.chat-tool').first().click()
    await expect(chat.locator('.chat-diff')).toHaveCount(0)
    await expect(pane.locator('.term-host.active')).toBeHidden()
    await expect(pane.locator('.term-host.active')).toHaveCount(1)

    await switchTo(pane, 'Terminal')
    await expect(chat).toBeHidden()
    await expect(pane.locator('.term-host.active')).toBeVisible()
    expect(await activeTermId(page)).toBe(termId)
    const text = await bufferText(page, termId)
    expect(text).toContain('READY claude')
    expect(text).toContain('MARKER-BEFORE-CHAT')
    expect(readSettings(sandbox).chatViews[`claude:${SESSION}`]).toBe('terminal')
  } finally {
    await closeApp(app)
  }
})

test('a message typed in chat goes to the terminal as a normal submit and the reply lands once its line is whole', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeLog(sandbox, seedConversation.slice(0, 2))
    const pane = await startClaude(page, sandbox)
    const termId = await activeTermId(page)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    await expect(chat.locator('.chat-say')).toContainText('RetryPolicy', { timeout: 15_000 })
    const box = chat.getByRole('textbox', { name: 'Message' })
    await expect(box).toHaveAttribute('placeholder', /^Message Claude/)
    await expect(chat.getByRole('button', { name: 'Send' })).toBeHidden()
    await box.fill('please cap the backoff')
    await expect(chat.getByRole('button', { name: 'Send' })).toBeVisible()
    await box.press('Enter')
    await expect(box).toHaveValue('')
    await expect.poll(() => bufferText(page, termId), { timeout: 15_000 }).toContain('GOT "please cap the backoff"')
    await expect(chat.locator('.chat-you').last()).toContainText('please cap the backoff', { timeout: 15_000 })
    await expect(chat.locator('.chat-say').last()).toHaveText('Echo: please cap the backoff', { timeout: 15_000 })
    await expect(chat.locator('.chat-thread')).not.toContainText('{"type"')
  } finally {
    await closeApp(app)
  }
})

test('working shows an indicator until the session stops, approvals reuse the card, menus offer the terminal', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeLog(sandbox, seedConversation)
    const pane = await startClaude(page, sandbox, 'busy')
    const termId = await activeTermId(page)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    await expect(chat.locator('.chat-say')).toContainText('RetryPolicy', { timeout: 15_000 })
    await expect(chat.locator('.chat-working')).toBeVisible({ timeout: 15_000 })
    await expect(chat.locator('.chat-working')).toContainText('Esc to interrupt')

    writeSession(sandbox, 'idle')
    await expect(chat.locator('.chat-working')).toHaveCount(0, { timeout: 15_000 })

    await feedTerminal(page, termId, '\r\n' + PERMISSION)
    const card = chat.locator('.pane-permission')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toContainText('Claude is asking to proceed')
    await expect(card).toContainText('npm install --save-dev vitest')
    await expect(chat.getByRole('textbox', { name: 'Message' })).toBeDisabled()
    await card.getByRole('button', { name: 'Allow Claude to continue' }).click()
    await expect.poll(() => bufferText(page, termId), { timeout: 15_000 }).toContain('GOT ""')
    await feedTerminal(page, termId, '\x1b[2J\x1b[H')
    await expect(chat.locator('.pane-permission')).toHaveCount(0, { timeout: 15_000 })

    await feedTerminal(page, termId, MENU)
    // A live picker such as /model shows as a card in chat, with the terminal one click away.
    const picker = chat.locator('.chat-ask')
    await expect(picker).toContainText('Select model', { timeout: 15_000 })
    await picker.getByRole('button', { name: 'Or answer in the terminal' }).click()
    await expect(chat).toBeHidden()
    await expect(pane.locator('.term-host.active')).toBeVisible()
    expect(await bufferText(page, termId)).toContain('Select model')
  } finally {
    await closeApp(app)
  }
})

test('a new session, a limit and Arabic read correctly', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const pane = await startClaude(page, sandbox)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    await expect(chat.locator('.chat-empty')).toContainText('Tell Claude what to do')
    await expect(chat.locator('.chat-empty')).toContainText('Working in Smoke')

    writeLog(sandbox, [
      { type: 'user', uuid: 'u1', message: { content: 'ضيف زرار للوضع الداكن' } },
      { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'أضفت الزرار في `settings.ts` وكل شيء يعمل' }] } },
      { type: 'assistant', uuid: 'a2', message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/ThemeToggle.tsx', old_string: 'a', new_string: 'b' } }] } },
      { type: 'user', uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }
    ])
    await expect(chat.locator('.chat-you')).toHaveAttribute('dir', 'rtl', { timeout: 15_000 })
    await expect(chat.locator('.chat-say')).toHaveAttribute('dir', 'rtl')
    await expect(chat.locator('.chat-say code')).toHaveAttribute('dir', 'ltr')
    await expect(chat.locator('.chat-tools')).toHaveAttribute('dir', 'ltr')
    await expect(chat.locator('.chat-tool bdi').first()).toHaveAttribute('dir', 'ltr')
    await expect(chat.locator('.chat-say')).toContainText('أضفت الزرار في')

    appendFileSync(
      logPath(sandbox),
      line({
        type: 'assistant',
        uuid: 'l1',
        apiError: 'usage_limit_reached',
        apiErrorParams: { rate_limit_info: { status: 'rejected', resetsAt: 1791907200 } },
        message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your session limit · resets 7pm" }] }
      })
    )
    const notice = chat.locator('.chat-notice')
    await expect(notice).toContainText('hit your session limit', { timeout: 15_000 })
    await expect(notice.getByRole('button', { name: 'Continue in Codex' })).toBeVisible()
    await notice.getByRole('button', { name: 'Wait for the reset' }).click()
    await expect(notice.getByRole('button')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('a log chat cannot read says why, offers the terminal and leaves the session running', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeLog(sandbox, Array.from({ length: 8 }, (_, index) => ({ shape: 'v2', index })))
    const pane = await startClaude(page, sandbox)
    const termId = await activeTermId(page)
    await switchTo(pane, 'Chat')
    const alert = pane.locator('.chat').getByRole('alert')
    await expect(alert).toContainText("Chat can't read this session", { timeout: 15_000 })
    await expect(alert).toContainText("format Dawsha doesn't know yet")
    await expect(alert).toContainText('keeps running in the terminal')
    await alert.getByRole('button', { name: 'Show terminal' }).click()
    await expect(pane.locator('.chat')).toBeHidden()
    expect(await bufferText(page, termId)).toContain('READY claude')
    await page.keyboard.type('still alive')
    await page.keyboard.press('Enter')
    await expect.poll(() => bufferText(page, termId)).toContain('GOT "still alive"')
  } finally {
    await closeApp(app)
  }
})

test('Gemini and shells never get the option, in the pane, in New session or by the default', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    await openSettings(page)
    await expect(page.locator('#default-view-gemini')).toHaveCount(0)
    await page.locator('#default-view-codex').getByRole('button', { name: 'Chat' }).click()
    await expect(page.locator('#default-view-codex').getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true')
    await page.locator('#sessions-button').click()

    await page.locator('#new-session').click()
    const dialog = page.getByRole('dialog', { name: 'New session' })
    await dialog.getByRole('radio', { name: /Gemini/ }).click()
    await expect(dialog.locator('.nd-view')).toHaveCount(0)
    await dialog.getByRole('radio', { name: /Codex/ }).click()
    await expect(dialog.locator('.nd-view')).toHaveCount(1)
    await expect(dialog.locator('.nd-view').getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true')
    await dialog.locator('.nd-view').getByRole('button', { name: 'Terminal' }).click()
    await dialog.getByRole('radio', { name: /Claude/ }).click()
    await expect(dialog.locator('.nd-view').getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true')
    await dialog.getByRole('radio', { name: /Codex/ }).click()
    await expect(dialog.locator('.nd-view').getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true')
    await dialog.getByRole('radio', { name: /Gemini/ }).click()
    await dialog.getByRole('button', { name: /^Start Gemini/ }).click()
    const pane = page.locator('.pane').first()
    await expect(pane).toBeVisible({ timeout: 20_000 })
    await expect(pane.locator('.chat-seg')).toBeHidden()
    await expect(pane.locator('.chat')).toBeHidden()
    await expect(pane.locator('.term-host.active')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('the default and each session remember their view across a relaunch, and New session can override the default', async () => {
  const sandbox = createSandbox()
  let session = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeLog(sandbox, seedConversation.slice(0, 2))
    await openSettings(session.page)
    await expect(session.page.locator('#default-view-claude').getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true')
    await expect(session.page.locator('#default-view-codex').getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true')
    await session.page.locator('#default-view-claude').getByRole('button', { name: 'Chat' }).click()
    await expect.poll(() => readSettings(sandbox).sessionViews).toEqual({ claude: 'chat', codex: 'terminal' })
    await session.page.locator('#sessions-button').click()

    const first = await startClaude(session.page, sandbox)
    await expect(first.locator('.chat')).toBeVisible()
    await expect(first.locator('.chat-say')).toContainText('RetryPolicy', { timeout: 15_000 })
    await switchTo(first, 'Terminal')
    await switchTo(first, 'Chat')
    await expect.poll(() => readSettings(sandbox).chatViews?.[`claude:${SESSION}`], { timeout: 15_000 }).toBe('chat')
  } finally {
    await closeApp(session.app)
  }
  session = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const page = session.page
    await openSettings(page)
    await expect(page.locator('#default-view-claude').getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#default-view-codex').getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true')
    await page.locator('#sessions-button').click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    const pane = page.locator('.pane').first()
    await expect(pane.locator('.chat')).toBeVisible()
    await switchTo(pane, 'Terminal')
    await expect(pane.locator('.chat')).toBeHidden()

    await page.locator('#new-session').click()
    const dialog = page.getByRole('dialog', { name: 'New session' })
    await dialog.getByRole('radio', { name: /Claude/ }).click()
    await expect(dialog.locator('.nd-view').getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true')
    await dialog.locator('.nd-view').getByRole('button', { name: 'Terminal' }).click()
    await dialog.getByRole('button', { name: /^Start Claude/ }).click()
    await expect(page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })
    const second = page.locator('.pane').nth(1)
    await expect(second.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true')
    await expect(second.locator('.chat')).toBeHidden()
  } finally {
    await closeApp(session.app)
  }
})

test('log content is drawn as text, long messages fold and huge output stays bounded', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const long = Array.from({ length: 60 }, (_, index) => `row ${index + 1}`).join('\n')
    writeLog(sandbox, [
      { type: 'user', uuid: 'u1', message: { content: '<img src=x onerror="window.__pwned=1"><b>bold?</b>' } },
      { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: long }] } },
      { type: 'assistant', uuid: 'a2', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo "<script>window.__pwned=2</script>"' } }] } },
      { type: 'user', uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '<svg onload="window.__pwned=3">\n'.repeat(5000) }] } }
    ])
    const pane = await startClaude(page, sandbox)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    await expect(chat.locator('.chat-you')).toContainText('<img src=x onerror="window.__pwned=1"><b>bold?</b>', { timeout: 15_000 })
    await expect(chat.locator('img, script, b, svg:not(.icon svg)')).toHaveCount(0)
    await expect(chat.locator('.chat-say')).not.toContainText('row 60')
    await chat.getByRole('button', { name: /Show \d+ more lines/ }).click()
    await expect(chat.locator('.chat-say')).toContainText('row 60')
    await chat.locator('.chat-tool').click()
    const output = chat.locator('.chat-toolout')
    await expect(output).toContainText('<svg onload')
    expect((await output.textContent())?.length ?? 0).toBeLessThan(7000)
    await expect(output).toContainText('Output too large to show in full')
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
  } finally {
    await closeApp(app)
  }
})

test('each agent opens in its own default and a remembered choice beats the default', async () => {
  const sandbox = createSandbox()
  const session = await launchApp(sandbox, agentEnv(sandbox))
  try {
    await openSettings(session.page)
    const claude = session.page.locator('#default-view-claude')
    const codex = session.page.locator('#default-view-codex')
    await codex.getByRole('button', { name: 'Chat' }).click()
    await expect(codex.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true')
    await expect(claude.getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => readSettings(sandbox).sessionViews).toEqual({ claude: 'terminal', codex: 'chat' })
    await session.page.locator('#sessions-button').click()

    const first = await startClaude(session.page, sandbox)
    await expect(first.locator('.chat')).toBeHidden()
    await expect(first.locator('.term-host.active')).toBeVisible()
    await session.page.locator('#new-session').click()
    const dialog = session.page.getByRole('dialog', { name: 'New session' })
    await dialog.getByRole('radio', { name: /Codex/ }).click()
    await expect(dialog.locator('.nd-view').getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true')
    await dialog.getByRole('button', { name: /^Start Codex/ }).click()
    await expect(session.page.locator('.pane')).toHaveCount(2, { timeout: 20_000 })
    const second = session.page.locator('.pane').nth(1)
    await expect(second.locator('.chat')).toBeVisible()
    await expect(second.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true')

    await switchTo(first, 'Chat')
    await expect.poll(() => readSettings(sandbox).chatViews?.[`claude:${SESSION}`], { timeout: 15_000 }).toBe('chat')
    await switchTo(first, 'Terminal')
    await expect.poll(() => readSettings(sandbox).chatViews?.[`claude:${SESSION}`], { timeout: 15_000 }).toBe('terminal')
    await openSettings(session.page)
    await session.page.locator('#default-view-claude').getByRole('button', { name: 'Chat' }).click()
    await expect.poll(() => readSettings(sandbox).sessionViews?.claude).toBe('chat')
    await session.page.locator('#sessions-button').click()
    await expect(first.locator('.chat')).toBeHidden()
  } finally {
    await closeApp(session.app)
  }
})

const ASK_SCREEN = ['', 'Which color?', '', '❯ 1. Red', '     Warm', '  2. Blue', '     Cool', '  3. Type something.', '', 'Enter to select · ↑/↓ to navigate · Esc to cancel', ''].join('\r\n')
const ASK_LOG = [
  { type: 'user', uuid: 'u1', message: { content: 'pick a color' } },
  {
    type: 'assistant',
    uuid: 'a1',
    message: { content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [{ question: 'Which color?', header: 'Color', multiSelect: false, options: [{ label: 'Red', description: 'Warm' }, { label: 'Blue', description: 'Cool' }] }] } }] }
  }
]

test('a question menu is answered from chat by pressing the option number', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeLog(sandbox, ASK_LOG)
    const pane = await startClaude(page, sandbox)
    const termId = await activeTermId(page)
    await expect.poll(() => bufferText(page, termId)).toContain('READY claude')
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    await feedTerminal(page, termId, ASK_SCREEN)
    const card = chat.locator('.chat-ask')
    await expect(card).toContainText('Which color?', { timeout: 15_000 })
    await expect(card.locator('.chat-opt')).toHaveCount(2)
    await expect(chat.getByRole('textbox', { name: 'Message' })).toBeDisabled()
    await card.locator('.chat-opt', { hasText: 'Blue' }).click()
    await expect(card).toContainText('Answer sent.')
    await expect.poll(() => bufferText(page, termId), { timeout: 15_000 }).toContain('KEY 2')
  } finally {
    await closeApp(app)
  }
})

test('markdown in a reply is drawn as a table, a list and emphasis, and links never navigate', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const reply = '## Plan\n\n| Name | Count |\n|---|:-:|\n| a | 1 |\n| b | 2 |\n\n- **bold** item\n  - nested\n1. one\n\n[site](https://example.com) and [file](src/a.ts)'
    writeLog(sandbox, [{ type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: reply }] } }])
    const pane = await startClaude(page, sandbox)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    await expect(chat.locator('.chat-table tbody tr')).toHaveCount(2, { timeout: 15_000 })
    await expect(chat.locator('.chat-table th')).toHaveText(['Name', 'Count'])
    await expect(chat.locator('.chat-say strong')).toHaveText('bold')
    await expect(chat.locator('.chat-list .chat-list li')).toHaveText('nested')
    await expect(chat.locator('.chat-link')).toHaveCount(1)
    await expect(chat.locator('.chat-say a')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('a sent message carries a marker until the log has it', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const pane = await startClaude(page, sandbox)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    const box = chat.getByRole('textbox', { name: 'Message' })
    await expect(box).toBeEnabled({ timeout: 15_000 })
    await box.fill('hello there')
    await box.press('Enter')
    await expect(chat.locator('.chat-you', { hasText: 'hello there' }).first()).toBeVisible({ timeout: 15_000 })
    await expect(chat.locator('.chat-say')).toContainText('Echo: hello there', { timeout: 15_000 })
    await expect(chat.locator('.chat-pend')).toHaveCount(0, { timeout: 15_000 })
  } finally {
    await closeApp(app)
  }
})

test('a file name in a reply is a link only when the file exists, and a click opens it in Files', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    mkdirSync(join(sandbox.projectFolder, 'src'), { recursive: true })
    writeFileSync(join(sandbox.projectFolder, 'src', 'retry.ts'), 'export const retries = 3\n'.repeat(20))
    writeLog(sandbox, [
      { type: 'user', uuid: 'l1', message: { role: 'user', content: 'Where is the retry?' } },
      { type: 'assistant', uuid: 'l2', message: { role: 'assistant', content: [{ type: 'text', text: 'See src/retry.ts:7 and `src/retry.ts` but not ghost/missing.ts' }] } },
      { type: 'assistant', uuid: 'l3', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'src/retry.ts', offset: 5 } }] } },
      { type: 'user', uuid: 'l4', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'x' }] } }
    ])
    const pane = await startClaude(page, sandbox)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    const links = chat.locator('.chat-say a.chat-file')
    await expect(links).toHaveCount(2, { timeout: 15_000 })
    await expect(links.first()).toHaveText('src/retry.ts:7')
    await expect(links.first()).not.toHaveAttribute('href', /.*/)
    await expect(chat.locator('.chat-say')).toContainText('ghost/missing.ts')
    await expect(chat.locator('.chat-say a', { hasText: 'ghost' })).toHaveCount(0)
    await expect(chat.locator('.chat-tool-open')).toHaveCount(1)
    await links.first().click()
    await expect(page.locator('#files-view')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.files-tab.active')).toContainText('retry.ts')
  } finally {
    await closeApp(app)
  }
})

test('files dropped on the chat become chips with a thumbnail and go with the next message, not into the terminal', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const shot = join(sandbox.projectFolder, 'shot.png')
    writeFileSync(shot, Buffer.from(PNG_BASE64, 'base64'))
    const pane = await startClaude(page, sandbox)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    const box = chat.getByRole('textbox', { name: 'Message' })
    await expect(box).toBeEnabled({ timeout: 15_000 })
    await box.evaluate((el, uri) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['x'], 'shot.png', { type: 'image/png' }))
      transfer.setData('text/uri-list', uri)
      const drop = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
      el.dispatchEvent(drop)
    }, `file:///${shot.replace(/\\/g, '/')}`)
    const chip = chat.locator('.chat-chip')
    await expect(chip).toHaveCount(1)
    await expect(chip).toContainText('shot.png')
    await expect(chip.locator('img')).toBeVisible({ timeout: 15_000 })
    expect(await bufferText(page, await activeTermId(page))).not.toContain('shot.png')
    await box.fill('what is this')
    await box.press('Enter')
    await expect(chat.locator('.chat-you', { hasText: 'what is this' }).first()).toContainText('shot.png', { timeout: 15_000 })
    await expect(chat.locator('.chat-chip')).toHaveCount(0)
    await box.evaluate((el) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['x'], 'a.png', { type: 'image/png' }))
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    })
    await expect(chat.locator('.chat-chip')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('day separators, copy buttons, folded compaction and thought rows, and a jump to the latest message', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const filler = Array.from({ length: 40 }, (_, i) => ({ type: 'assistant', uuid: `f${i}`, timestamp: '2026-10-14T09:00:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: `Filler paragraph number ${i}` }] } }))
    writeLog(sandbox, [
      { type: 'user', uuid: 'd1', timestamp: '2026-10-13T09:00:00.000Z', message: { role: 'user', content: 'Day one question' } },
      { type: 'assistant', uuid: 'd2', timestamp: '2026-10-13T09:01:00.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Considering the options' }, { type: 'text', text: 'Run this:\n\n```\nnpm test\n```' }] } },
      { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-14T08:00:00.000Z' },
      { type: 'user', uuid: 'd3', timestamp: '2026-10-14T08:00:01.000Z', isCompactSummary: true, message: { role: 'user', content: 'SECRET-SUMMARY of the earlier talk' } },
      ...filler
    ])
    const pane = await startClaude(page, sandbox)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    await expect(chat.locator('.chat-day')).toHaveCount(2, { timeout: 15_000 })
    await expect(chat.locator('.chat-compact')).toContainText('Conversation compacted')
    await expect(chat.locator('.chat-jump')).toBeHidden()
    await expect(chat.locator('.chat-compact')).not.toContainText('SECRET-SUMMARY')
    await chat.getByRole('button', { name: 'Show summary' }).click()
    await expect(chat.locator('.chat-compact')).toContainText('SECRET-SUMMARY')
    await expect(chat.locator('.chat-tool', { hasText: 'Thought' })).toHaveCount(1)
    await expect(chat.locator('.chat-codewrap .chat-copy')).toHaveCount(1)
    await chat.locator('.chat-scroll').evaluate((el) => {
      el.scrollTop = 0
    })
    await expect(chat.locator('.chat-jump')).toBeVisible()
    await chat.locator('.chat-jump').click()
    await expect(chat.locator('.chat-jump')).toBeHidden()
  } finally {
    await closeApp(app)
  }
})

test('tool cards: a checklist, the chosen answers, a collapsible plan and a sub-agent report', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const questions = [{ header: 'Lib', question: 'Which library?', multiSelect: false, options: [{ label: 'zod', description: 'schemas' }, { label: 'yup', description: 'older' }] }]
    const use = (id: string, name: string, input: unknown) => ({ type: 'assistant', uuid: `a-${id}`, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
    const done = (id: string, content: unknown, toolUseResult?: unknown) => ({ type: 'user', uuid: `u-${id}`, ...(toolUseResult ? { toolUseResult } : {}), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } })
    writeLog(sandbox, [
      use('t1', 'TodoWrite', { todos: [{ content: 'Write the tests', status: 'completed' }, { content: 'Ship it', status: 'in_progress' }] }),
      done('t1', 'ok'),
      use('q1', 'AskUserQuestion', { questions }),
      done('q1', 'User has answered', { questions, answers: { 'Which library?': 'zod' } }),
      use('p1', 'ExitPlanMode', { plan: '# The plan\n\n- first step\n- second step' }),
      done('p1', 'approved'),
      use('g1', 'Task', { description: 'Find the flaky test', subagent_type: 'general-purpose', prompt: 'long prompt' }),
      done('g1', [{ type: 'text', text: 'It is **login.spec.ts**' }])
    ])
    const pane = await startClaude(page, sandbox)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    await expect(chat.locator('.chat-todos li')).toHaveCount(2, { timeout: 15_000 })
    await expect(chat.locator('.chat-todos .todo.completed')).toContainText('Write the tests')
    await expect(chat.locator('.chat-answers')).toContainText('Which library?')
    await expect(chat.locator('.chat-answers dd')).toHaveText('zod')
    await expect(chat.locator('.chat-card')).toHaveCount(0)
    await chat.locator('.chat-tool', { hasText: 'Plan' }).click()
    await expect(chat.locator('.chat-card li')).toHaveCount(2)
    await chat.locator('.chat-tool', { hasText: 'Plan' }).click()
    await expect(chat.locator('.chat-card')).toHaveCount(0)
    await expect(chat.locator('.chat-tool', { hasText: 'Agent' })).toContainText('Find the flaky test')
    await chat.locator('.chat-tool', { hasText: 'Agent' }).click()
    await expect(chat.locator('.chat-card strong')).toHaveText('login.spec.ts')
  } finally {
    await closeApp(app)
  }
})

test('a pasted picture shows as a thumbnail, opens in a lightbox and its actions work', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeLog(sandbox, [
      { type: 'user', uuid: 'p1', message: { role: 'user', content: [{ type: 'text', text: 'What is in this picture?' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 } }, { type: 'text', text: '[Image: source: C:\\tmp\\shot.png]' }] } },
      { type: 'assistant', uuid: 'p2', message: { role: 'assistant', content: [{ type: 'text', text: 'One pixel.' }] } }
    ])
    const pane = await startClaude(page, sandbox)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    await expect(chat.locator('.chat-you')).toContainText('What is in this picture?', { timeout: 15_000 })
    await expect(chat.locator('.chat-you')).not.toContainText('[Image: source')
    const thumb = chat.locator('.chat-thumb')
    await expect(thumb).toHaveCount(1)
    await expect(thumb.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/, { timeout: 15_000 })

    await thumb.click()
    const box = page.locator('.chat-lightbox')
    await expect(box).toBeVisible()
    await expect(box.locator('img')).toBeVisible({ timeout: 15_000 })
    await box.getByRole('button', { name: 'Open externally' }).click()
    await expect.poll(() => (existsSync(sandbox.openLog) ? readFileSync(sandbox.openLog, 'utf8') : '')).toContain('"kind":"image"')
    await page.keyboard.press('Escape')
    await expect(box).toHaveCount(0)

    await thumb.click()
    await expect(box).toBeVisible()
    await page.mouse.click(5, 5)
    await expect(box).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('the background strip shows an agent as running, then done, and a click opens its report', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const started = new Date(Date.now() - 65_000).toISOString()
    const launch = [
      { type: 'user', uuid: 'b1', timestamp: started, message: { role: 'user', content: 'Research it in the background' } },
      { type: 'assistant', uuid: 'b2', timestamp: started, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tb1', name: 'Agent', input: { description: 'Research the gaps', subagent_type: 'general-purpose', prompt: 'Look' } }] } },
      { type: 'user', uuid: 'b3', timestamp: started, toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'agent42', description: 'Research the gaps' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tb1', content: [{ type: 'text', text: 'Async agent launched successfully.' }] }] } }
    ]
    writeLog(sandbox, launch)
    const pane = await startClaude(page, sandbox)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    const strip = chat.locator('.chat-bg')
    await expect(strip).toBeVisible({ timeout: 15_000 })
    await expect(strip.locator('.chat-bg-count')).toHaveText('1 running')
    await expect(chat.locator('[data-tool="tb1"] .chat-badge')).toHaveText('Running…')
    await strip.locator('.chat-bg-head').click()
    const row = strip.locator('.chat-bg-row')
    await expect(row).toContainText('Research the gaps')
    await expect(row).toContainText('general-purpose')
    await expect(row.locator('.chat-bg-time')).toHaveText(/^1m \d\ds$/)

    const note = '<task-notification>\n<task-id>agent42</task-id>\n<tool-use-id>tb1</tool-use-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n<result>The final report.</result>\n</task-notification>'
    appendFileSync(logPath(sandbox), line({ type: 'user', uuid: 'b4', timestamp: new Date().toISOString(), message: { role: 'user', content: note } }))
    await expect(strip.locator('.chat-bg-count')).toHaveText('1 done', { timeout: 15_000 })
    await expect(chat.locator('[data-tool="tb1"] .chat-badge')).toHaveText('Done')
    await expect(chat.locator('.chat-you')).toHaveCount(1)
    await expect(chat).not.toContainText('task-notification')

    await strip.locator('.chat-bg-row').click()
    await expect(chat.locator('.chat-card')).toContainText('The final report.')
  } finally {
    await closeApp(app)
  }
})

const iso = (base: number, seconds: number): string => new Date(base + seconds * 1000).toISOString()
const looked = (id: string, name: string, input: unknown, base: number, seconds: number, output: string): unknown[] => [
  { type: 'assistant', uuid: `${id}-a`, timestamp: iso(base, seconds), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } },
  { type: 'user', uuid: `${id}-r`, timestamp: iso(base, seconds + 1), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] } }
]

test('looking around folds into one line, a finished turn says how long it took, and Ctrl+F finds text inside folded rows', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    const base = Date.now() - 600_000
    writeLog(sandbox, [
      { type: 'user', uuid: 'g1', timestamp: iso(base, 0), message: { role: 'user', content: 'Look around the sender' } },
      ...looked('r1', 'Read', { file_path: 'src/a.ts' }, base, 5, 'alpha NEEDLE-ONE'),
      ...looked('r2', 'Read', { file_path: 'src/b.ts' }, base, 8, 'beta'),
      ...looked('r3', 'Grep', { pattern: 'retry' }, base, 11, 'gamma NEEDLE-TWO'),
      ...looked('r4', 'Read', { file_path: 'src/c.ts' }, base, 14, 'delta'),
      ...looked('e1', 'Edit', { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' }, base, 20, 'ok'),
      { type: 'assistant', uuid: 'g9', timestamp: iso(base, 134), message: { role: 'assistant', content: [{ type: 'text', text: 'All done, the needle-one is in a.ts.' }] } }
    ])
    const pane = await startClaude(page, sandbox)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    const group = chat.locator('.chat-group')
    await expect(group).toHaveCount(1, { timeout: 15_000 })
    await expect(group).toHaveText('Read 3 files, searched 1 time · 15s')
    await expect(chat.locator('.chat-tool:not(.chat-group)')).toHaveCount(1)
    await expect(chat.locator('.chat-tool:not(.chat-group)')).toContainText('src/a.ts')
    await expect(chat.locator('[data-worked]')).toHaveText(/^Worked 2m 14s · 5 tools$/)

    await group.click()
    await expect(chat.locator('.chat-group-body .chat-tool')).toHaveCount(4)
    await group.click()
    await expect(chat.locator('.chat-group-body')).toHaveCount(0)

    const box = chat.getByRole('textbox', { name: 'Message' })
    await box.click()
    await page.keyboard.press('Control+f')
    const find = chat.locator('.chat-find')
    await expect(find).toBeVisible()
    await page.keyboard.type('needle')
    await expect(find.locator('.term-find-count')).toHaveText('1 of 3')
    await expect(chat.locator('.chat-group-body .chat-tool')).toHaveCount(4)
    await expect(chat.locator('.chat-toolout')).toHaveCount(2)
    expect(await page.evaluate(() => CSS.highlights.has('chat-find') && CSS.highlights.has('chat-find-current'))).toBe(true)
    await page.keyboard.press('Enter')
    await expect(find.locator('.term-find-count')).toHaveText('2 of 3')
    await page.keyboard.press('Shift+Enter')
    await expect(find.locator('.term-find-count')).toHaveText('1 of 3')
    await page.keyboard.press('Escape')
    await expect(find).toBeHidden()
    await expect(chat.locator('.chat-toolout')).toHaveCount(0)
    await expect(chat.locator('.chat-group-body')).toHaveCount(0)
    expect(await page.evaluate(() => CSS.highlights.has('chat-find'))).toBe(false)
  } finally {
    await closeApp(app)
  }
})

test('the bell on a running turn raises a desktop notification when it finishes', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeLog(sandbox, [{ type: 'user', uuid: 'w1', timestamp: new Date().toISOString(), message: { role: 'user', content: 'Refactor the sender' } }])
    const pane = await startClaude(page, sandbox, 'busy')
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    const bell = chat.locator('.chat-you [data-bell]')
    await expect(bell).toBeVisible({ timeout: 15_000 })
    await expect(bell).toHaveAttribute('aria-pressed', 'false')
    await bell.click()
    await expect(bell).toHaveAttribute('aria-pressed', 'true')
    writeSession(sandbox, 'idle')
    appendFileSync(logPath(sandbox), line({ type: 'assistant', uuid: 'w2', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: 'Refactored.' }] } }))
    await expect.poll(() => (existsSync(sandbox.notifyLog) ? readFileSync(sandbox.notifyLog, 'utf8') : ''), { timeout: 20_000 }).toContain('Claude is done')
    expect(readFileSync(sandbox.notifyLog, 'utf8')).toContain('Refactor the sender')
    await expect(chat.locator('[data-bell]')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('a prompt saved with /save is offered first in the / list, inserts its text, and is managed in Settings', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeLog(sandbox, seedConversation.slice(0, 2))
    const pane = await startClaude(page, sandbox)
    await switchTo(pane, 'Chat')
    const chat = pane.locator('.chat')
    const box = chat.getByRole('textbox', { name: 'Message' })
    await expect(chat.locator('.chat-say')).toContainText('RetryPolicy', { timeout: 15_000 })
    await box.fill('/save Review the latest change for bugs')
    await box.evaluate((el: HTMLTextAreaElement) => {
      el.setSelectionRange(5, 5)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect(chat.locator('.chat-complete-group').first()).toHaveText('Saved')
    await expect(chat.locator('.chat-complete-row').first()).toContainText('save')
    await box.press('Enter')
    await page.locator('.dialog input').fill('Review change')
    await page.locator('.dialog [data-confirm]').click()
    await expect(box).toHaveValue('Review the latest change for bugs')
    await expect.poll(() => readSettings(sandbox).savedPrompts?.[0]?.name).toBe('Review change')

    await box.fill('')
    await box.pressSequentially('/rev')
    await expect(chat.locator('.chat-complete-group').first()).toHaveText('Saved')
    await expect(chat.locator('.chat-complete-row').first()).toContainText('Review change')
    await box.press('Enter')
    await expect(box).toHaveValue('Review the latest change for bugs')

    await openSettings(page, 'general')
    const entry = page.locator('#saved-prompts [data-saved-prompt]')
    await expect(entry).toContainText('Review change')
    await entry.getByRole('button', { name: 'Delete Review change' }).click()
    await expect(page.locator('.dialog')).toContainText('"Review change"')
    await expect(page.locator('.dialog [data-confirm]')).toHaveText('Delete "Review change"')
    await page.locator('.dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(entry).toHaveCount(1)
    await entry.getByRole('button', { name: 'Delete Review change' }).click()
    await page.locator('.dialog [data-confirm]').click()
    await expect(entry).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox).savedPrompts).toEqual([])
  } finally {
    await closeApp(app)
  }
})
