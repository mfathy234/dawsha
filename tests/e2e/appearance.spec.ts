import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openSettings, type Sandbox } from './helpers'

const AGENT = resolve(__dirname, '../support/chatAgent.cjs')
const SESSION = '5b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8'
const line = (record: unknown): string => JSON.stringify(record) + '\n'
const logPath = (sandbox: Sandbox): string => join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'), `${SESSION}.jsonl`)
const settingsOf = (sandbox: Sandbox): Record<string, any> => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))

function seedSettings(sandbox: Sandbox, patch: Record<string, unknown>): void {
  const file = join(sandbox.userData, 'settings.json')
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...patch }), 'utf8')
}

function git(folder: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd: folder, encoding: 'utf8' })
}

function makeRepo(sandbox: Sandbox): void {
  const root = sandbox.projectFolder
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.ts'), 'const a = 1\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true }))
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'base')
  git(root, 'update-ref', `refs/dawsha/checkpoints/${SESSION}/${createHash('sha1').update('u1').digest('hex').slice(0, 16)}`, 'HEAD')
  writeFileSync(join(root, 'src', 'a.ts'), 'const a = 2\nconst b = 3\n')
  writeFileSync(join(root, 'created.ts'), 'export const created = true\n')
}

const iso = (): string => new Date().toISOString()
const reply = (): string => [
  { type: 'user', uuid: 'u1', timestamp: iso(), message: { role: 'user', content: 'Change a' } },
  { type: 'assistant', uuid: 'e1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'const a = 1', new_string: 'const a = 2\nconst b = 3' } }] } },
  { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  { type: 'assistant', uuid: 'e2', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Write', input: { file_path: 'created.ts', content: 'export const created = true\n' } }] } },
  { type: 'user', uuid: 'r2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } },
  { type: 'assistant', uuid: 'a1', timestamp: iso(), message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } }
].map(line).join('')

function writeSession(sandbox: Sandbox): void {
  const now = Date.now()
  writeFileSync(join(sandbox.sessionsDir, `${SESSION}.json`), JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, name: 'Change a', nameSource: 'user', status: 'idle', startedAt: now, updatedAt: now }))
}

async function chooseAppearance(page: Page, group: 'Panes' | 'Frame' | 'Tone' | 'Layout when Dawsha opens', label: string): Promise<void> {
  await openSettings(page, 'appearance')
  await page.getByRole('group', { name: group, exact: true }).getByRole('button', { name: label, exact: true }).click()
}

const cssVar = (page: Page, name: string): Promise<string> => page.evaluate((variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim().toLowerCase(), name)

test('each option switches live and survives a restart', async () => {
  const sandbox = createSandbox()
  let { app, page } = await launchApp(sandbox)
  try {
    await expect(page.locator('.app')).not.toHaveClass(/panes-quiet|frame-sidebar|tone-warm/)
    const coolCanvas = await cssVar(page, '--canvas')

    await chooseAppearance(page, 'Panes', 'Quiet')
    await expect(page.locator('.app')).toHaveClass(/panes-quiet/)
    await expect.poll(() => settingsOf(sandbox).appearance?.panes).toBe('quiet')

    await chooseAppearance(page, 'Tone', 'Warm')
    await expect(page.locator('.app')).toHaveClass(/tone-warm/)
    await expect.poll(() => cssVar(page, '--canvas')).toBe('#161615')
    expect(coolCanvas).not.toBe('#161615')
    await expect.poll(() => settingsOf(sandbox).appearance?.tone).toBe('warm')

    await chooseAppearance(page, 'Frame', 'Sidebar')
    await expect(page.locator('.app')).toHaveClass(/frame-sidebar/)
    await expect(page.locator('.topbar')).toBeHidden()
    await expect.poll(() => settingsOf(sandbox).appearance?.frame).toBe('sidebar')

    await chooseAppearance(page, 'Layout when Dawsha opens', 'Board')
    await expect.poll(() => settingsOf(sandbox).sessionsLayout).toBe('board')
    await expect(page.locator('.settings-view')).toBeVisible()
    await chooseAppearance(page, 'Layout when Dawsha opens', 'Grid')
    await expect.poll(() => settingsOf(sandbox).sessionsLayout).toBe('grid')

    await closeApp(app)
    ;({ app, page } = await launchApp(sandbox))
    await expect(page.locator('.app')).toHaveClass(/panes-quiet/)
    await expect(page.locator('.app')).toHaveClass(/tone-warm/)
    await expect(page.locator('.app')).toHaveClass(/frame-sidebar/)
    await expect.poll(() => cssVar(page, '--canvas')).toBe('#161615')
    await expect(page.locator('#new-session')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('Use it sets all three, and Back to Classic puts them back', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await openSettings(page, 'appearance')
    await page.locator('#appearance-use-desktop').click()
    await expect(page.locator('.app')).toHaveClass(/panes-quiet/)
    await expect(page.locator('.app')).toHaveClass(/tone-warm/)
    await expect(page.locator('.app')).toHaveClass(/frame-sidebar/)
    await expect.poll(() => settingsOf(sandbox).appearance).toEqual({ panes: 'quiet', frame: 'sidebar', tone: 'warm' })
    await expect(page.locator('#appearance-desktop-on')).toHaveText('On')
    await expect(page.locator('#appearance-use-desktop')).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Panes', exact: true }).getByRole('button', { name: 'Quiet' })).toHaveAttribute('aria-pressed', 'true')

    await page.locator('#appearance-back-classic').click()
    await expect(page.locator('.app')).not.toHaveClass(/panes-quiet|frame-sidebar|tone-warm/)
    await expect(page.locator('.topbar')).toBeVisible()
    await expect.poll(() => settingsOf(sandbox).appearance).toEqual({ panes: 'classic', frame: 'topbar', tone: 'cool' })
    await expect(page.locator('#new-session')).toBeVisible()
    await expect(page.locator('.topbar #settings-button')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('the Sidebar frame still opens Agents, Files, Settings, Search and New session', async () => {
  const sandbox = createSandbox()
  seedSettings(sandbox, { appearance: { panes: 'classic', frame: 'sidebar', tone: 'cool' } })
  const { app, page } = await launchApp(sandbox)
  try {
    const sidebar = page.locator('.sidebar')
    for (const id of ['#new-session', '#search-button', '#sessions-button', '#background-button', '#files-button', '#work-button', '#skills-button', '#settings-button', '#more-button']) {
      await expect(sidebar.locator(id)).toBeVisible()
    }
    await expect(page.locator('.topbar')).toBeHidden()

    await page.locator('#background-button').click()
    await expect(page.locator('#background-button')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.crew-roster')).toBeVisible()

    await page.locator('#files-button').click()
    await expect(page.locator('.files-view')).toBeVisible()
    await expect(page.locator('#sessions-button')).toBeVisible()

    await page.locator('#settings-button').click()
    await expect(page.locator('.settings-view')).toBeVisible()

    await page.locator('#sessions-button').click()
    await page.locator('#new-session').click({ position: { x: 60, y: 10 } })
    await expect(page.locator('.quickpick')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.locator('#search-button').click()
    await expect(page.locator('.palette')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.locator('#sidebar-collapse').click()
    await expect(sidebar).toHaveClass(/rail/)
    for (const id of ['#new-session', '#files-button', '#settings-button']) await expect(sidebar.locator(id)).toBeVisible()
    await page.locator('#files-button').click()
    await expect(page.locator('.files-view')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})

test('a Quiet terminal sums up the last reply and offers Review, Commit this reply and Undo', async () => {
  const sandbox = createSandbox()
  makeRepo(sandbox)
  seedSettings(sandbox, { appearance: { panes: 'quiet', frame: 'topbar', tone: 'cool' } })
  mkdirSync(join(logPath(sandbox), '..'), { recursive: true })
  writeFileSync(logPath(sandbox), reply())
  const node = process.execPath
  const { app, page } = await launchApp(sandbox, { CHAT_LOG: logPath(sandbox), DAWSHA_CLAUDE_COMMAND: node, DAWSHA_CLAUDE_ARGS: JSON.stringify([AGENT, 'claude']) })
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    const pane = page.locator('.pane').first()
    await expect(pane).toBeVisible({ timeout: 20_000 })
    writeSession(sandbox)
    const summary = pane.locator('.pane-reply')
    await expect(summary).toContainText('Last reply edited 2 files', { timeout: 20_000 })
    await expect(summary.getByRole('button', { name: 'Review' })).toBeVisible()
    await expect(summary.getByRole('button', { name: /Commit this reply/ })).toBeVisible()
    await expect(summary.getByRole('button', { name: /Undo this reply/ })).toBeVisible({ timeout: 20_000 })
    await expect(pane.locator('.pane-body .chat')).toBeHidden()

    await summary.getByRole('button', { name: /Commit this reply/ }).click()
    await expect(pane.locator('.pane-reply-pop .turn-commit')).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await expect(pane.locator('.pane-reply-pop')).toBeHidden()

    await pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(pane.locator('.chat-turn-summary')).toBeVisible({ timeout: 20_000 })
    await expect(pane.locator('.pane-reply')).toBeHidden()
  } finally {
    await closeApp(app)
  }
})
