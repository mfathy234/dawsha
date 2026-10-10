import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, runCli, QUIT_BUDGET_MS } from './helpers'

const readSettings = (userData: string): any => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
const CLAUDE_ID = '11111111-2222-4333-8444-555555555555'

test('the dawsha command talks to the running app over the pipe', async () => {
  const sandbox = createSandbox()
  const dir = join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${CLAUDE_ID}.jsonl`),
    [
      JSON.stringify({ type: 'user', message: { content: 'Add a dark mode toggle' } }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Add dark mode toggle' })
    ].join('\n') + '\n'
  )
  const { app, page } = await launchApp(sandbox, { DAWSHA_CODEX_COMMAND: 'cmd.exe' })
  try {
    const version = await runCli(sandbox, ['--version'])
    expect(version).toMatchObject({ code: 0, out: expect.stringMatching(/^Dawsha \d+\.\d+\.\d+$/) })

    const help = await runCli(sandbox, ['--help'])
    expect(help.code).toBe(0)
    expect(help.out).toContain('Usage: dawsha [command]')

    const ls = await runCli(sandbox, ['ls'])
    expect(ls.code).toBe(0)
    expect(ls.out.split('\n')[0]).toMatch(/^NAME\s+AGENT\s+FOLDER\s+SESSIONS$/)
    expect(ls.out).toMatch(/Smoke\s+claude\s+.*Smoke Project\s+0/)

    const unknown = await runCli(sandbox, ['launch'])
    expect(unknown.code).toBe(2)
    expect(unknown.err).toContain("Unknown command 'launch'")
    expect((await runCli(sandbox, ['start', 'nope'])).code).toBe(1)

    const started = await runCli(sandbox, ['start', 'Smoke', '--agent', 'codex'])
    expect(started).toMatchObject({ code: 0, out: 'Smoke: started Codex in pane 1' })
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane-header .agent-mark.codex')).toHaveCount(1)
    expect((await runCli(sandbox, ['ls'])).out).toMatch(/Smoke\s+claude\s+.*Smoke Project\s+1/)

    const sessions = await runCli(sandbox, ['sessions', 'Smoke'])
    expect(sessions.out).toMatch(/AGENT\s+TITLE\s+LAST ACTIVE\s+ID/)
    expect(sessions.out).toMatch(/claude\s+Add dark mode toggle\s+.*ago\s+111111/)

    const resumed = await runCli(sandbox, ['resume', '--last'], sandbox.projectFolder)
    expect(resumed).toMatchObject({ code: 0, out: "Resumed 'Add dark mode toggle' (Claude Code) in pane 2" })
    await expect(page.locator('.pane')).toHaveCount(2)
    await expect.poll(() => readSettings(sandbox.userData).workspace?.panes?.[1]?.tabs?.[0]?.sessionId).toBe(CLAUDE_ID)
    const again = await runCli(sandbox, ['resume', '--last'], sandbox.projectFolder)
    expect(again.out).toBe("'Add dark mode toggle' (Claude Code) is already open in pane 2")
    await expect(page.locator('.pane')).toHaveCount(2)

    const picker = await runCli(sandbox, ['resume'], sandbox.projectFolder)
    expect(picker.out).toBe('Opened the resume picker for Smoke')
    await expect(page.locator('.resume-picker')).toBeVisible()
    await expect(page.locator('#rp-project')).toHaveValue('smoke')
    await page.keyboard.press('Escape')

    const fresh = join(sandbox.root, 'new-thing')
    mkdirSync(fresh)
    const dot = await runCli(sandbox, ['.'], fresh)
    expect(dot).toMatchObject({ code: 0, out: 'Added project new-thing · started Claude Code' })
    await expect(page.locator('.pane')).toHaveCount(3)
    await expect.poll(() => readSettings(sandbox.userData).projects.map((p: any) => p.name)).toContain('new-thing')
    const dotAgain = await runCli(sandbox, ['.'], fresh)
    expect(dotAgain.out).toBe('new-thing: started Claude Code (default agent) in a new pane')
    await expect(page.locator('.pane')).toHaveCount(4)

    const added = await runCli(sandbox, ['add', sandbox.root, '--name', 'sandbox-root'])
    expect(added.out).toBe(`Added project sandbox-root (${sandbox.root})`)
    const missing = await runCli(sandbox, ['add', join(sandbox.root, 'nowhere')])
    expect(missing.code).toBe(1)
    expect(missing.err).toContain('This folder does not exist.')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('a second launch with arguments is forwarded to the running app', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    const env = { ...process.env, DAWSHA_USER_DATA: sandbox.userData, DAWSHA_PIPE: sandbox.pipe } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    const electronPath = require('electron') as unknown as string
    const child = spawn(electronPath, [resolve(__dirname, '../../out/main/index.js'), 'ls'], { env, stdio: 'ignore' })
    await new Promise<void>((done) => child.on('close', () => done()))
    await expect(page.locator('.toast')).toContainText('NAME')
    await expect(page.locator('.toast')).toContainText('Smoke')
  } finally {
    await closeApp(app)
  }
})
