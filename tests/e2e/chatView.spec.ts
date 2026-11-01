import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { activeTermId, bufferText, closeApp, createSandbox, feedTerminal, launchApp, openSettings, type Sandbox } from './helpers'

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
    const notice = chat.locator('.chat-notice')
    await expect(notice).toContainText('Claude is showing a menu.', { timeout: 15_000 })
    await notice.getByRole('button', { name: 'Show terminal' }).click()
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
