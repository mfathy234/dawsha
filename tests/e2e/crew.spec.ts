import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, feedTerminal, launchApp, openMore, runCli, backToAgents, type Sandbox } from './helpers'

const FAKE = resolve(__dirname, '../support/fakeAgent.cjs')
const SESSION = '55555555-6666-4777-8888-999999999999'
const PROMPT = ['  npm run migrate -- --env dev', 'Do you want to run this command?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', ''].join('\r\n')

const readSettings = (sandbox: Sandbox): any => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))

function fakeEnv(sandbox: Sandbox): Record<string, string> {
  const node = process.execPath
  return {
    FAKE_AGENT_LOG: join(sandbox.root, 'agent-log'),
    DAWSHA_CLAUDE_COMMAND: node,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([FAKE, 'claude']),
    DAWSHA_CODEX_COMMAND: node,
    DAWSHA_CODEX_ARGS: JSON.stringify([FAKE, 'codex']),
    DAWSHA_GEMINI_COMMAND: node,
    DAWSHA_GEMINI_ARGS: JSON.stringify([FAKE, 'gemini']),
    DAWSHA_SHARED_HOME: join(sandbox.root, 'shared-home')
  }
}

function agentArgs(sandbox: Sandbox, name = 'claude'): string[] {
  try {
    return JSON.parse(readFileSync(join(sandbox.root, 'agent-log', `${name}.json`), 'utf8')).args
  } catch {
    return []
  }
}

function writeSession(sandbox: Sandbox, status: 'busy' | 'idle'): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${SESSION}.json`),
    JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, status, startedAt: now + 1000, updatedAt: now + 1000 }),
    'utf8'
  )
}

async function openAgents(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1024, height: 728 })
  await page.locator('#background-button').click()
  await expect(page.locator('.crew-view')).toBeVisible()
}

test('the Agents tab is the crew: built-ins in sections, Maya taking goals, and the old badge gone', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await openAgents(page)
    await expect(page.getByRole('heading', { name: 'Agents', level: 1 })).toBeVisible()
    await expect(page.locator('#background-button')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#background-button .count-badge')).toHaveCount(0)
    await expect(page.locator('.crew-sec span:first-child')).toHaveText(['Your agents', 'Built in'])
    await expect(page.locator('.crew-item')).toHaveCount(8)
    await expect(page.locator('.crew-item[data-member="maya"]')).toContainText('Give her a goal')
    for (const name of ['Sami', 'Tarek', 'Omar', 'Hana', 'Lina', 'Nour', 'Yara']) await expect(page.locator(`.crew-item[data-member="${name.toLowerCase()}"]`)).toContainText(name)
    await expect(page.locator('.crew-goalbox')).toBeVisible()
    await expect(page.locator('#crew-goal-go')).toHaveText('Hand it to Maya')
    await page.locator('.crew-item[data-member="sami"]').click()
    await expect(page.locator('.crew-dh h2')).toHaveText('Sami')
    await expect(page.locator('.crew-form input[aria-label="Name"]')).toHaveJSProperty('readOnly', true)
    await expect(page.locator('[data-crew-preview]')).toContainText('--permission-mode plan')
    await backToAgents(page)
    await page.locator('.crew-item[data-member="tarek"]').click()
    await expect(page.locator('.crew-form')).toContainText('Codex runs with full access on this PC')
    await page.screenshot({ path: join(sandbox.root, 'crew-list.png') })
  } finally {
    await closeApp(app)
  }
})

test('creates a member, duplicates a built-in, hides one and deletes with the name on the button', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await openAgents(page)
    await page.locator('#crew-new').click()
    const name = page.locator('.crew-form input[aria-label="Name"]')
    await name.fill('Zed')
    await page.locator('.crew-form input[aria-label="Role"]').fill('Release checker')
    await page.locator('.crew-form textarea[aria-label="Prompt"]').fill('Check {{version}} on {{env}}')
    await expect(page.locator('.crew-vars code')).toHaveText(['{{version}}', '{{env}}'])
    await page.locator('.crew-swatch[data-colour="cyan"]').click()
    await page.locator('.crew-radio[data-value="read"]').click()
    await expect(page.locator('[data-crew-preview]')).toContainText('--permission-mode plan')
    await expect.poll(() => readSettings(sandbox).crew?.members?.[0]).toMatchObject({ name: 'Zed', role: 'Release checker', colour: 'cyan', permissions: 'read', prompt: 'Check {{version}} on {{env}}' })
    await backToAgents(page)
    await expect(page.locator('.crew-item[data-member="new-agent"]')).toContainText('Release checker')
    await expect(page.locator('.crew-sec', { hasText: 'Your agents' })).toContainText('1')

    await page.locator('.crew-item[data-member="hana"]').click()
    await page.locator('#crew-hide').click()
    await backToAgents(page)
    await expect(page.locator('.crew-sec', { hasText: 'Hidden' })).toBeVisible()
    await expect.poll(() => readSettings(sandbox).crew.hidden).toEqual(['hana'])
    await page.locator('.crew-item[data-member="hana"]').click()
    await page.locator('#crew-hide').click()
    await backToAgents(page)
    await expect(page.locator('.crew-sec', { hasText: 'Hidden' })).toHaveCount(0)

    await page.locator('.crew-item[data-member="sami"]').click()
    await page.locator('#crew-duplicate').click()
    await expect(page.locator('.crew-dh h2')).toHaveText('Sami 2')
    await expect(page.locator('.crew-form input[aria-label="Name"]')).toHaveJSProperty('readOnly', false)

    await page.locator('#crew-delete').click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Delete Sami 2?')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.crew-item[data-member="sami-2"]')).toHaveCount(1)
    await page.locator('#crew-delete').click()
    await page.getByRole('button', { name: 'Delete Sami 2', exact: true }).click()
    await expect(page.locator('.crew-item[data-member="sami-2"]')).toHaveCount(0)
    await page.locator('.crew-search').fill('release')
    await expect(page.locator('.crew-item')).toHaveCount(2)
  } finally {
    await closeApp(app)
  }
})

test('runs a member in a pane titled with its name, the avatar follows the session, and the strip shows who is on a job', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await openAgents(page)
    await page.locator('.crew-item[data-member="sami"] .crew-runbtn').click({ force: true })
    const dialog = page.getByRole('dialog', { name: 'Run Sami' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('radio', { name: 'Gemini', exact: true }).click()
    await expect(dialog.locator('[data-gemini-warning]')).toBeVisible()
    await expect(dialog.locator('#crew-run-go')).toBeDisabled()
    await dialog.getByRole('radio', { name: /Member default/ }).click()
    await expect(dialog.locator('[data-gemini-warning]')).toBeHidden()
    await expect(dialog.locator('[data-crew-run-preview]')).toContainText('claude --model sonnet --permission-mode plan --strict-mcp-config')
    await page.screenshot({ path: join(sandbox.root, 'crew-run-dialog.png') })
    await dialog.getByLabel('Target').fill('PR 8841')
    await dialog.locator('#crew-run-go').click()

    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane-title')).toContainText('Sami · PR 8841')
    const avatar = page.locator('.pane-header .crew-av')
    await expect(avatar).toHaveAttribute('aria-label', /^Sami, /)
    await expect.poll(() => agentArgs(sandbox).includes('--append-system-prompt')).toBe(true)
    const args = agentArgs(sandbox)
    expect(args).toEqual(expect.arrayContaining(['--model', 'sonnet', '--permission-mode', 'plan', '--strict-mcp-config']))
    expect(args.at(-1)).toBe('Review PR 8841. Report findings most severe first, with file:line.')
    expect(args[args.indexOf('--append-system-prompt') + 1]).toContain('You are a code reviewer')
    expect(JSON.parse(readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8'))).toEqual({ mcpServers: {} })
    await expect.poll(() => readSettings(sandbox).crewRuns?.[0]).toMatchObject({ memberName: 'Sami', title: 'Sami · PR 8841', outcome: 'running' })

    writeSession(sandbox, 'busy')
    await expect(avatar).toHaveAttribute('data-state', 'working', { timeout: 20_000 })
    await expect(page.locator('#crew-strip')).toBeVisible()
    await expect(page.locator('#crew-strip')).toContainText('1 working')
    await expect(page.locator('.sess-row .crew-av[data-state="working"]')).toHaveCount(1)

    const termId = (await page.locator('.pane .term-host').first().getAttribute('data-term-id')) ?? ''
    await expect(async () => {
      await feedTerminal(page, termId, '\r\n' + PROMPT)
      await expect(avatar).toHaveAttribute('data-state', 'needs', { timeout: 1500 })
    }).toPass({ timeout: 30_000 })
    await expect(page.locator('#crew-strip')).toContainText('1 needs you')
    await expect(page.locator('#crew-strip .crew-av')).toHaveAttribute('aria-label', 'Sami, Needs you')
    await page.screenshot({ path: join(sandbox.root, 'crew-strip-needs.png') })

    writeSession(sandbox, 'idle')
    await feedTerminal(page, termId, '\x1b[2J\x1b[H')
    await expect(avatar).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
    await expect(page.locator('#crew-strip')).toContainText('1 done')
    await expect.poll(() => readSettings(sandbox).crewRuns[0].outcome, { timeout: 20_000 }).toBe('done')

    await page.locator('#crew-strip .crew-strip-btn').click()
    await expect(page.locator('.pane.focused')).toHaveCount(1)
    await expect(page.locator('#crew-strip .crew-av')).toHaveCount(0, { timeout: 5000 })
    await openAgents(page)
    await page.locator('.crew-item[data-member="sami"]').click()
    await page.locator('.crew-tab[data-tab="runs"]').click()
    await expect(page.locator('.crew-runrow')).toHaveCount(1)
    await expect(page.locator('.crew-runrow')).toContainText('Sami · PR 8841')
    await expect(page.locator('.crew-runrow')).toContainText('Done')
    await page.locator('.crew-runrow').click()
    await expect(page.locator('.pane.focused .pane-title')).toContainText('Sami · PR 8841')
  } finally {
    await closeApp(app)
  }
})

test('runs the other CLIs with the instructions in the first message and the model as a flag', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await openAgents(page)
    await page.locator('.crew-item[data-member="tarek"]').click()
    await page.locator('#crew-run-main').click()
    const dialog = page.getByRole('dialog', { name: 'Run Tarek' })
    await expect(dialog.locator('[data-crew-run-preview]')).toContainText('--dangerously-bypass-approvals-and-sandbox')
    await expect(dialog).toContainText('Codex runs with full access on this PC')
    await dialog.getByLabel('Problem').fill('login test flakes')
    await dialog.getByRole('radio', { name: 'Background' }).click()
    await dialog.locator('#crew-run-go').click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect.poll(() => agentArgs(sandbox, 'codex').length).toBeGreaterThan(0)
    const args = agentArgs(sandbox, 'codex')
    expect(args.at(-1)).toMatch(/^<instructions>\nYou are a debugger\./)
    expect(args.at(-1)).toContain('Find the root cause of: login test flakes. Reproduce it first.')
    expect(args).not.toContain('--append-system-prompt')
    await expect(page.locator('.crew-view')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('turns a skill into an agent from the Skills view, with the reasons shown and everything editable', async () => {
  const sandbox = createSandbox()
  const skill = join(sandbox.claudeHome, 'skills', 'correlation-id')
  mkdirSync(skill, { recursive: true })
  writeFileSync(
    join(skill, 'SKILL.md'),
    '---\nname: correlation-id\ndescription: Investigates why a request failed from its correlation id. Use when the user pastes a correlation id and names an environment (dev, stage, uat, preprod). Works on Smoke.\n---\n\n# Correlation id\nRead-only. Never print credentials.\n'
  )
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await openMore(page, 'skills')
    const row = page.locator('.skill-row', { hasText: 'correlation-id' })
    await row.getByRole('button', { name: 'Make an agent' }).click()
    const dialog = page.getByRole('dialog', { name: /Make an agent from correlation-id/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.crew-skill-src mark').first()).toBeVisible()
    await expect(dialog.locator('.crew-vars').first()).toContainText('{{id}}')
    await expect(dialog.locator('.crew-vars').first()).toContainText('{{env}}')
    await expect(dialog.getByLabel('Prompt')).toHaveValue(/Correlation id \{\{id\}\} on \{\{env\}\}/)
    await expect(dialog.locator('.crew-why', { hasText: 'read-only' })).toBeVisible()
    await expect(dialog.locator('.crew-chip-btn[aria-checked="true"]', { hasText: 'Read only' })).toBeVisible()
    await expect(dialog.getByLabel('Projects')).toHaveValue('Smoke')
    await expect(dialog.locator('.crew-why', { hasText: 'Pasting a match' })).toBeVisible()
    await page.screenshot({ path: join(sandbox.root, 'crew-convert.png') })
    await dialog.getByLabel('Name').fill('Zaid')
    await dialog.getByLabel('Role').fill('Incident investigator')
    await dialog.locator('#crew-convert-go').click()
    await expect(row.locator('[data-skill-member="Zaid"]')).toBeVisible()
    await expect.poll(() => readSettings(sandbox).crew?.members?.[0]).toMatchObject({
      name: 'Zaid',
      role: 'Incident investigator',
      permissions: 'read',
      projects: ['Smoke'],
      source: { kind: 'skill', linked: true },
      paste: [{ kind: 'guid', field: 'id', envField: 'env' }]
    })

    await page.locator('#background-button').click()
    await expect(page.locator('.crew-item[data-member="zaid"]')).toContainText('Incident investigator')
    await page.locator('.crew-item[data-member="zaid"]').click()
    await expect(page.locator('.crew-src')).toContainText('Linked to')
  } finally {
    await closeApp(app)
  }
})

test('imports agent files, and paste to run suggests the member with the fields filled in', async () => {
  test.setTimeout(90_000)
  const sandbox = createSandbox()
  mkdirSync(join(sandbox.claudeHome, 'agents'), { recursive: true })
  writeFileSync(join(sandbox.claudeHome, 'agents', 'pr-review.md'), '---\nname: pr-review\ndescription: Reviews changes against house standards.\nmodel: opus\ncolor: orange\ntools: Read, Grep\n---\nNever edit anything.\n')
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await openAgents(page)
    await page.locator('#crew-import').click()
    const dialog = page.getByRole('dialog', { name: 'Import agents' })
    const imported = dialog.locator('.crew-import-row', { hasText: 'pr-review.md' })
    await expect(imported).toBeVisible()
    await expect(imported.getByRole('checkbox')).toBeChecked()
    await dialog.locator('#crew-import-go').click()
    await expect.poll(() => readSettings(sandbox).crew?.members?.[0]).toMatchObject({ colour: 'orange', model: 'opus', permissions: 'read', source: { kind: 'agent', linked: true } })
    const imported$ = readSettings(sandbox).crew.members[0]
    await backToAgents(page)
    await page.locator(`.crew-item[data-member="${imported$.id}"]`).click()
    await expect(page.locator('.crew-src')).toContainText('pr-review.md')
    writeFileSync(join(sandbox.claudeHome, 'agents', 'pr-review.md'), '---\nname: pr-review\ndescription: Reviews changes against house standards.\nmodel: opus\n---\nNever edit anything. Updated on disk.\n')

    await page.locator('#background-button').click()
    await page.locator('#sessions-button').click()
    await page.locator('#new-session-agent').click()
    await page.locator('#crew-hand-menu-item').click()
    const hand = page.getByRole('dialog', { name: 'Hand a job to an agent' })
    const url = 'https://dev.azure.com/MicrotecEgypt/Platforms/_git/Platforms/pullrequest/8841'
    await hand.getByLabel('What to hand over').fill(url)
    await expect(hand.locator('.crew-hand-row').first()).toContainText('Sami')
    await expect(hand.locator('.crew-hand-row').first()).toContainText('PR 8841')
    await expect(hand.locator('.crew-hand-row').last()).toContainText('New session with this text')
    await hand.getByLabel('What to hand over').press('Enter')
    await expect(page.locator('.pane-title')).toContainText('Sami · ')
    await expect.poll(() => agentArgs(sandbox).at(-1) ?? '').toContain(url)

    await page.locator('#new-session-agent').click()
    await page.locator('#crew-hand-menu-item').click()
    const again = page.getByRole('dialog', { name: 'Hand a job to an agent' })
    await again.getByLabel('What to hand over').fill('just some notes')
    await expect(again.locator('.crew-hand-row')).toHaveCount(1)
    await again.getByLabel('What to hand over').press('Enter')
    await expect(page.locator('.pane')).toHaveCount(2)
  } finally {
    await closeApp(app)
  }
})

test('the dawsha crew commands list, run and report on members', async () => {
  test.setTimeout(90_000)
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    const list = await runCli(sandbox, ['crew', 'list'])
    expect(list.code).toBe(0)
    expect(list.out).toMatch(/NAME\s+ROLE\s+MODEL\s+FIELDS/)
    expect(list.out).toMatch(/Sami\s+Code reviewer\s+claude Sonnet\s+target/)

    expect((await runCli(sandbox, ['crew', 'run', 'sami', '--project', 'Nope', '--field', 'target=x'])).code).toBe(1)
    const missing = await runCli(sandbox, ['crew', 'run', 'sami', '--project', 'Smoke'])
    expect(missing).toMatchObject({ code: 1 })
    expect(missing.err).toContain('Sami needs --field target=...')

    const started = await runCli(sandbox, ['crew', 'run', 'sami', '--project', 'Smoke', '--model', 'haiku', '--field', 'target=PR 9', '--background'])
    expect(started.code).toBe(0)
    expect(started.out).toMatch(/^[a-z0-9]{6}$/)
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane-title')).toContainText('Sami · PR 9')
    await expect.poll(() => agentArgs(sandbox)).toEqual(expect.arrayContaining(['--model', 'haiku']))
    const status = await runCli(sandbox, ['crew', 'status', started.out])
    expect(status.code).toBe(0)
    expect(status.out).toMatch(/^(working|needs|done|idle)$/)
    const all = await runCli(sandbox, ['crew', 'status'])
    expect(all.out).toContain(started.out)
    expect(all.out).toContain('Sami · PR 9')
    expect((await runCli(sandbox, ['crew', 'status', 'zzzzzz'])).code).toBe(1)

    await expect(async () => {
      const result = await runCli(sandbox, ['crew', 'result', started.out])
      expect(result.code).toBe(0)
      expect(result.out).toContain('READY claude')
    }).toPass({ timeout: 30_000 })
    expect((await runCli(sandbox, ['crew', 'result', 'zzzzzz'])).code).toBe(1)
    expect((await runCli(sandbox, ['crew', 'run', 'maya', '--project', 'Smoke', '--field', 'goal=x'])).err).toContain('is the Lead and takes goals from the Agents page')
    const gemini = await runCli(sandbox, ['crew', 'run', 'nour', '--project', 'Smoke', '--field', 'version=1.7.6'])
    expect(gemini.code).toBe(1)
    expect(gemini.err).toContain('Gemini is not signed in')
  } finally {
    await closeApp(app)
  }
})
