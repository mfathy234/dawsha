import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { activeTermId, closeApp, createSandbox, feedTerminal, launchApp, type Sandbox, QUIT_BUDGET_MS } from './helpers'

const SCREENS = 'test-results/screens'
const FAKE = resolve(__dirname, '../support/fakeAgent.cjs')
const SESSION = 'sess-handoff-1'

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))

function git(cwd: string, ...args: string[]): void {
  const identity = ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid']
  execFileSync('git', [...identity, ...args], { cwd })
}

function prepareRepo(folder: string): void {
  git(folder, 'init', '-q', '-b', 'main')
  writeFileSync(join(folder, 'README.md'), 'hello\n')
  git(folder, 'add', '.')
  git(folder, 'commit', '-q', '-m', 'first')
  writeFileSync(join(folder, 'README.md'), 'hello again\n')
  mkdirSync(join(folder, 'tests'))
  writeFileSync(join(folder, 'tests', 'login.spec.ts'), 'test()\n')
}

function writeTranscriptSource(sandbox: Sandbox): void {
  const dir = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${SESSION}.jsonl`),
    [
      JSON.stringify({ type: 'user', timestamp: '2026-10-08T09:12:00.000Z', message: { content: 'Make the login test stop timing out on #dashboard' } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'I replaced the fixed sleep with a wait for the dashboard.' }] } })
    ].join('\n') + '\n'
  )
}

function seedOldHandoffs(sandbox: Sandbox): void {
  const dir = join(sandbox.userData, 'handoffs')
  mkdirSync(dir, { recursive: true })
  for (let index = 0; index < 55; index += 1) {
    const file = join(dir, `old-${String(index).padStart(2, '0')}.md`)
    writeFileSync(file, 'old')
    const when = new Date(Date.now() - (100 + index) * 60_000)
    utimesSync(file, when, when)
  }
}

function writeSession(sandbox: Sandbox): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${SESSION}.json`),
    JSON.stringify({
      pid: process.pid,
      sessionId: SESSION,
      cwd: sandbox.projectFolder,
      name: 'Fix flaky login test',
      nameSource: 'user',
      status: 'idle',
      startedAt: now + 1000,
      updatedAt: now + 1000
    }),
    'utf8'
  )
  mkdirSync(sandbox.opsDir, { recursive: true })
  writeFileSync(
    join(sandbox.opsDir, `${SESSION}.json`),
    JSON.stringify({
      v: 1,
      sessionId: SESSION,
      cwd: sandbox.projectFolder,
      updatedAt: now,
      ended: false,
      model: 'claude-opus-5-5',
      plan: { title: 'Stabilise login', done: 3, total: 6 },
      agents: [],
      files: [],
      checks: [
        { kind: 'build', target: 'acme-web', ok: true, summary: 'Build succeeded', at: now - 120_000 },
        { kind: 'test', target: 'acme-web', ok: false, summary: '40 passed 1 failed', at: now - 60_000 }
      ]
    }),
    'utf8'
  )
}

test('continues a session in another agent with an editable summary and a from chip', async () => {
  const sandbox = createSandbox()
  prepareRepo(sandbox.projectFolder)
  seedOldHandoffs(sandbox)
  const logDir = join(sandbox.root, 'agent-log')
  const node = process.execPath
  const { app, page } = await launchApp(sandbox, {
    FAKE_AGENT_LOG: logDir,
    DAWSHA_CLAUDE_COMMAND: node,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([FAKE, 'claude']),
    DAWSHA_CODEX_COMMAND: node,
    DAWSHA_CODEX_ARGS: JSON.stringify([FAKE, 'codex']),
    DAWSHA_GEMINI_COMMAND: node,
    DAWSHA_GEMINI_ARGS: JSON.stringify([FAKE, 'gemini'])
  })
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const sourceId = await activeTermId(page)
    writeTranscriptSource(sandbox)
    writeSession(sandbox)
    await expect(page.locator('.pane-title', { hasText: 'Fix flaky login test' })).toHaveCount(1, { timeout: 20_000 })
    await expect(page.locator('.info-plan')).toHaveText('▸ 3/6', { timeout: 20_000 })
    await feedTerminal(page, sourceId, '\x1b[31mError: timeout waiting for #dashboard\x1b[0m\r\n')

    await page.getByRole('button', { name: 'Pane actions' }).click()
    await expect(page.getByRole('menuitem', { name: /Continue in/ })).toHaveText(['Continue in Codex', 'Continue in Gemini'])
    await page.getByRole('menuitem', { name: 'Continue in Codex' }).click()
    const dialog = page.getByRole('dialog', { name: 'Continue in Codex' })
    await expect(dialog).toBeVisible()
    const summary = dialog.getByLabel('Handoff summary')
    await expect(summary).toHaveValue(
      /^Continue this task\. First read the transcript file at "[^"]+handoffs[\\/]Smoke-claude-\d{8}-\d{6}\.md"\. It is the full conversation of the previous Claude Code session in Smoke\./
    )
    const path = /at "([^"]+)"/.exec(await summary.inputValue())?.[1] ?? ''
    expect(path.startsWith(join(sandbox.userData, 'handoffs'))).toBe(true)
    const saved = readFileSync(path, 'utf8')
    expect(saved).toContain('Make the login test stop timing out on #dashboard')
    expect(saved).toContain('I replaced the fixed sleep with a wait for the dashboard.')
    const kept = readdirSync(join(sandbox.userData, 'handoffs'))
    expect(kept).toHaveLength(50)
    expect(kept).toContain(basename(path))
    expect(kept).toContain('old-00.md')
    expect(kept).not.toContain('old-54.md')
    await expect(dialog.locator('.handoff-file-path')).toHaveText(basename(path))
    await expect(dialog.locator('.handoff-file-path')).toHaveAttribute('title', path)
    await expect(dialog.getByRole('button', { name: 'Show in folder' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Copy path' })).toBeVisible()
    await expect(dialog.locator('.handoff-note')).toHaveCount(0)
    await expect(summary).toHaveValue(/summarise in a few lines where things stand, then continue from there\.$/)
    await expect(summary).not.toHaveValue(/Recent terminal output/)
    await expect(summary).toHaveValue(/Goal: Fix flaky login test/)
    await expect(summary).toHaveValue(/Files touched \(2\):\n- README\.md\n- tests\/login\.spec\.ts/)
    await expect(summary).toHaveValue(/What's left: 3 plan steps\./)
    await expect(summary).toHaveValue(/Last error: test failed: 40 passed 1 failed/)
    expect(await summary.inputValue()).not.toContain('\x1b')
    await page.screenshot({ path: join(SCREENS, '50-handoff-dialog.png') })
    await page.screenshot({ path: join(SCREENS, '162-handoff-dialog.png') })

    await summary.fill('')
    await dialog.getByRole('button', { name: 'Start Codex with this' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('The first message cannot be empty.')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.pane')).toHaveCount(1)

    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Continue in Codex' }).click()
    const again = page.getByRole('dialog', { name: 'Continue in Codex' })
    const edited = `${await again.getByLabel('Handoff summary').inputValue()}\nPlease keep the "fixed wait" fix & rerun %PATH% checks.`
    await again.getByLabel('Handoff summary').fill(edited)
    await again.getByRole('button', { name: 'Start Codex with this' }).click()
    await expect(page.locator('.pane')).toHaveCount(2)
    await expect(page.locator('.pane').nth(1).locator('.chip-from')).toHaveText('from Claude')
    await expect(page.locator('.pane').nth(1).locator('.pane-header .agent-mark.codex')).toHaveCount(1)
    await expect(page.locator('.pane').first().locator('.chip-from')).toBeHidden()
    const codexLog = join(logDir, 'codex.json')
    await expect
      .poll(() => (existsSync(codexLog) ? JSON.parse(readFileSync(codexLog, 'utf8')).args : null), {
        timeout: 30_000,
        message: `the fake codex agent did not write ${codexLog}`
      })
      .toEqual([edited])
    const codex = JSON.parse(readFileSync(codexLog, 'utf8'))
    expect(codex.cwd).toBe(sandbox.projectFolder)
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.[1]?.tabs?.[0]?.from).toBe('claude')
    await page.screenshot({ path: join(SCREENS, '51-handoff-pane.png') })

    await page.locator('.pane').nth(1).getByRole('button', { name: 'Pane actions' }).click()
    await expect(page.getByRole('menuitem', { name: /Continue in/ })).toHaveText(['Continue in Claude', 'Continue in Gemini'])
    await page.keyboard.press('Escape')

    await expect(page.locator('.pane').nth(1).getByRole('button', { name: 'Pane actions' })).toBeFocused()
    await page.keyboard.press('Control+k')
    await expect(page.locator('#palette-input')).toBeFocused()
    await page.keyboard.type('continue in gem')
    await expect(page.locator('.palette-row')).toHaveText(['Continue in Gemini'])
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Continue in Gemini' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Continue in Gemini' })).toHaveCount(0)
    await expect(page.locator('.pane')).toHaveCount(2)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('summarises an unnamed session outside a git repository and says what it does not know', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Continue in Gemini' }).click()
    const summary = page.getByRole('dialog', { name: 'Continue in Gemini' }).getByLabel('Handoff summary')
    const dialog = page.getByRole('dialog', { name: 'Continue in Gemini' })
    await expect(dialog.locator('.handoff-note')).toContainText('No saved conversation was found')
    await expect(dialog.locator('.handoff-file')).toHaveCount(0)
    await expect(summary).toHaveValue(/^Continue this task\. Handoff from Claude Code in Smoke\./)
    await expect(summary).toHaveValue(/Goal: \(not captured, describe it here\)/)
    await expect(summary).toHaveValue(/Files touched: none found/)
    await expect(summary).toHaveValue(/Last error: none seen/)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
