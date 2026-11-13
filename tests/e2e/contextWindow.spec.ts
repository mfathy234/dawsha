import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { activeTermId, bufferText, closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

const AGENT = resolve(__dirname, '../support/chatAgent.cjs')
const SESSION = '7c2d3e4f-5061-4a72-8b83-a4b5c6d7e8fa'
const logPath = (sandbox: Sandbox): string => join(sandbox.claudeHome, 'projects', sandbox.projectFolder.replace(/[^A-Za-z0-9]/g, '-'), `${SESSION}.jsonl`)

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

function writeOps(sandbox: Sandbox, percent: number, tokens: number): void {
  mkdirSync(sandbox.opsDir, { recursive: true })
  const snapshot = { v: 1, sessionId: SESSION, cwd: sandbox.projectFolder, updatedAt: Date.now(), ended: false, model: 'claude-opus-5-5', agents: [], context: { percent, tokens, window: 200_000, stage: 'fine' }, compactions: 0, limits: [], files: [], checks: [] }
  writeFileSync(join(sandbox.opsDir, `${SESSION}.json`), JSON.stringify(snapshot), 'utf8')
}

function writeSession(sandbox: Sandbox): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${SESSION}.json`),
    JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, name: 'Billing refactor', nameSource: 'user', status: 'idle', startedAt: now + 1000, updatedAt: now + 1000 }),
    'utf8'
  )
}

test('the header ring shows the share, opens the Context window, Esc closes it and Compact reaches the agent', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    mkdirSync(join(logPath(sandbox), '..'), { recursive: true })
    writeFileSync(logPath(sandbox), '')
    writeOps(sandbox, 41, 82_000)
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    writeSession(sandbox)
    const termId = await activeTermId(page)
    const ring = page.locator('.pane .pane-header').getByRole('button', { name: /^Context 41% used/ })
    await expect(ring).toContainText('41%', { timeout: 15_000 })

    await ring.click()
    const pop = page.getByRole('dialog', { name: 'Context' })
    await expect(pop).toContainText('41% of 200K used')
    await expect(pop).toContainText('Used 82K')
    await expect(pop).toContainText('Free 118K')
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await expect(ring).toBeFocused()

    await ring.click()
    await page.getByRole('dialog', { name: 'Context' }).getByRole('button', { name: 'Compact', exact: true }).click()
    await expect.poll(() => bufferText(page, termId), { timeout: 15_000 }).toContain('GOT "/compact"')

    await ring.click()
    await page.getByRole('dialog', { name: 'Context' }).getByRole('button', { name: 'Clear', exact: true }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('Billing refactor')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await page.mouse.click(5, 5)
  } finally {
    await closeApp(app)
  }
})

test('Quiet panes move the context gauge from the footer into the header ring', async () => {
  const sandbox = createSandbox()
  const file = join(sandbox.userData, 'settings.json')
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), appearance: { panes: 'quiet', frame: 'topbar', tone: 'cool' } }), 'utf8')
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    writeOps(sandbox, 83, 166_000)
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    writeSession(sandbox)
    const ring = page.locator('.pane .pane-header .ctx-ring')
    await expect(ring).toHaveAttribute('data-stage', 'warn', { timeout: 15_000 })
    await expect(page.locator('.pane .pane-foot .info-context')).toBeHidden()
  } finally {
    await closeApp(app)
  }
})

test('an update keeps focus on Compact, and closing the pane with the window open leaves nothing behind', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, agentEnv(sandbox))
  try {
    mkdirSync(join(logPath(sandbox), '..'), { recursive: true })
    writeFileSync(logPath(sandbox), '')
    writeOps(sandbox, 41, 82_000)
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    writeSession(sandbox)
    const ring = page.locator('.pane .pane-header').getByRole('button', { name: /^Context 41% used/ })
    await expect(ring).toContainText('41%', { timeout: 15_000 })

    await ring.click()
    const pop = page.getByRole('dialog', { name: 'Context' })
    const compact = pop.getByRole('button', { name: 'Compact', exact: true })
    await compact.focus()
    writeOps(sandbox, 55, 110_000)
    await expect(pop).toContainText('55% of 200K used', { timeout: 15_000 })
    await expect(compact).toBeFocused()

    await page.keyboard.press('Control+k')
    // A click event without a pointerdown, as a shortcut or another window closing the pane would cause.
    await page.evaluate(() => document.querySelector<HTMLElement>('.pane .close-pane')?.click())
    await expect(page.locator('.pane')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.locator('.ctx-pop')).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Context' })).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
