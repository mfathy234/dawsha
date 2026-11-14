import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { activeTermId, closeApp, createSandbox, feedTerminal, launchApp, type Sandbox } from './helpers'

const FAKE = resolve(__dirname, '../support/fakeAgent.cjs')
const SESSION = '55555555-6666-4777-8888-999999999999'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

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

function writeSession(sandbox: Sandbox, status: 'busy' | 'idle'): void {
  const now = Date.now()
  writeFileSync(join(sandbox.sessionsDir, `${SESSION}.json`), JSON.stringify({ pid: process.pid, sessionId: SESSION, cwd: sandbox.projectFolder, status, startedAt: now + 1000, updatedAt: now + 1000 }), 'utf8')
}

function makeRepo(sandbox: Sandbox): string {
  const repo = sandbox.projectFolder
  mkdirSync(join(repo, 'src'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), 'hello\nworld\n')
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const one = 1\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  writeFileSync(join(repo, 'README.md'), 'hello\nagain\nworld\n')
  writeFileSync(join(repo, 'src', 'new.ts'), 'export const fresh = 1\n')
  return repo
}

const openReview = async (page: Page): Promise<void> => {
  await page.locator('#files-button').click()
  await expect(page.locator('#files-view')).toBeVisible()
  await page.locator('#files-mode-review').click()
}

async function captureWrites(app: ElectronApplication, termId: string): Promise<void> {
  await app.evaluate(({ ipcMain }, id) => {
    ;(globalThis as any).__writes = []
    ipcMain.on('pty:write', (_event, target, text) => {
      if (target === id) (globalThis as any).__writes.push(text)
    })
  }, termId)
}

const written = (app: ElectronApplication): Promise<string> => app.evaluate(() => ((globalThis as any).__writes as string[]).join(''))

async function comment(page: Page, file: string, text: string): Promise<void> {
  await page.locator(`.files-review-row[data-path="${file}"] .files-review-open`).click()
  await page.locator('.files-editor:not([hidden]) .cm-review-add').first().click()
  await page.locator('.cm-review-input').fill(text)
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('.cm-review-text').last()).toHaveText(text)
}

test('two comments on a diff go to the session as one message with the diff around each line', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await captureWrites(app, await activeTermId(page))
    await openReview(page)
    await comment(page, 'README.md', 'Why again?')
    await comment(page, 'src/new.ts', 'Name this better')
    await expect(page.locator('#files-comments-head')).toContainText('Comments (2)')
    await expect(page.locator('#files-review-send')).toHaveText('Send 2 comments to Claude')
    await page.locator('#files-comments .files-comment-jump').first().click()
    await expect(page.locator('.files-tab.active')).toContainText('README.md')
    await page.locator('#files-review-send').click()
    await expect.poll(() => written(app)).toContain('2 comments')
    const sent = await written(app)
    expect(sent).toContain('1. README.md:2')
    expect(sent).toContain('Why again?')
    expect(sent).toContain('2. src/new.ts:1')
    expect(sent).toContain('Name this better')
    expect(sent).toContain('+ again')
    await expect(page.locator('#files-comments-head')).toContainText('Comments (0)')
    await expect(page.locator('#files-comments-head')).toContainText('2 sent')
    await expect.poll(() => readSettings(sandbox).reviewDrafts.map((draft: any) => draft.status)).toEqual(['sent', 'sent'])
  } finally {
    await closeApp(app)
  }
})

test('drafts survive a restart and follow their line when it moves', async () => {
  test.setTimeout(150_000)
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox)
  let launched = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await openReview(launched.page)
    await comment(launched.page, 'README.md', 'Keep this one')
    await expect.poll(() => readSettings(sandbox).reviewDrafts?.[0]).toMatchObject({ path: 'README.md', line: 2, status: 'open', text: 'Keep this one' })
  } finally {
    await closeApp(launched.app)
  }
  writeFileSync(join(repo, 'README.md'), 'top\nhello\nagain\nworld\n')
  launched = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await openReview(launched.page)
    await expect(launched.page.locator('#files-comments-head')).toContainText('Comments (1)')
    await launched.page.locator('#files-comments .files-comment-jump').click()
    await expect(launched.page.locator('.cm-review-text')).toHaveText('Keep this one')
    await expect.poll(() => readSettings(sandbox).reviewDrafts?.[0]?.line).toBe(3)
    writeFileSync(join(repo, 'README.md'), 'top\nhello\nsomething else\nworld\n')
    await launched.page.locator('#files-review-prev').click()
    await launched.page.locator('#files-review-next').click()
    await expect(launched.page.locator('#files-comments .files-comment-flag')).toHaveText('Outdated', { timeout: 15_000 })
  } finally {
    await closeApp(launched.app)
  }
})

test('a reviewer in the background returns findings that land on the right lines, with Send, Dismiss and Fix all', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await page.locator('#new-session-agent').click()
    await page.getByRole('menuitem', { name: /Codex session/ }).click()
    await expect(page.locator('.quickpick')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(1)
    const authorTerm = await activeTermId(page)
    await captureWrites(app, authorTerm)
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Review this session…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Review this session' })
    await expect(dialog).toContainText('read-only plan mode')
    await dialog.getByRole('radio', { name: 'Uncommitted changes' }).check()
    await dialog.locator('#review-start').click()
    await expect(page.locator('.pane')).toHaveCount(2)
    await expect.poll(() => readSettings(sandbox).crewRuns?.[0]).toMatchObject({ memberName: 'Sami', outcome: 'running', title: expect.stringContaining('Review:') })

    await openReview(page)
    await expect(page.locator('#review-card')).toContainText('Claude is reviewing')
    writeSession(sandbox, 'busy')
    await page.waitForTimeout(5000)
    const reviewerTerm = (await page.locator('.pane .term-host').nth(1).getAttribute('data-term-id')) ?? ''
    const reply = ['```json', '{"findings": [', '{"file": "README.md",', ' "line": 2,', ' "severity": "high",', ' "title": "Wrong word",', ' "explanation": "Say it once",', ' "suggested_fix": "Remove it"},', '{"file": "README.md",', ' "line": 3,', ' "severity": "medium",', ' "title": "Odd ending",', ' "explanation": "world stands alone",', ' "suggested_fix": ""},', '{"file": "src/new.ts",', ' "line": 1,', ' "severity": "low",', ' "title": "Naming",', ' "explanation": "fresh is vague",', ' "suggested_fix": ""}', ']}', '```', ''].join('\r\n')
    await feedTerminal(page, reviewerTerm, reply)
    writeSession(sandbox, 'idle')
    await expect(page.locator('#review-card')).toContainText('3 findings: 1 high, 1 medium, 1 low', { timeout: 60_000 })
    await expect(page.locator('#files-comments-head')).toContainText('Comments (3)')

    await page.locator('.files-review-row[data-path="README.md"] .files-review-open').click()
    const box = page.locator('.cm-review-comment').first()
    await expect(box).toContainText('Review by Claude, high')
    await expect(box).toContainText('Wrong word')
    await expect(box).toContainText('Suggested fix: Remove it')
    await box.getByRole('button', { name: 'Send to Codex' }).click()
    await expect.poll(() => written(app)).toContain('Reviewer (high): Wrong word')
    expect(await written(app)).toContain('1. README.md:2')

    await page.locator('.files-review-row[data-path="src/new.ts"] .files-review-open').click()
    await page.locator('.files-editor:not([hidden]) .cm-review-comment').getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.locator('.files-editor:not([hidden]) .cm-review-comment')).toHaveCount(0)
    await expect(page.locator('#review-card')).toContainText('Fix all (1)')
    await page.locator('#review-card-fix').click()
    await expect.poll(() => written(app)).toContain('Reviewer (medium): Odd ending')
    await expect.poll(() => readSettings(sandbox).reviewDrafts.map((draft: any) => draft.status).sort()).toEqual(['dismissed', 'sent', 'sent'])
  } finally {
    await closeApp(app)
  }
})

test('a reply that cannot be read as findings is shown as it came', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox()
  makeRepo(sandbox)
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await page.locator('#new-session-agent').click()
    await page.getByRole('menuitem', { name: /Codex session/ }).click()
    await expect(page.locator('.quickpick')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('.pane')).toHaveCount(1)
    await page.getByRole('button', { name: 'Pane actions' }).click()
    await page.getByRole('menuitem', { name: 'Review this session…' }).click()
    await page.getByRole('dialog', { name: 'Review this session' }).locator('#review-start').click()
    await expect(page.locator('.pane')).toHaveCount(2)
    await openReview(page)
    writeSession(sandbox, 'busy')
    await page.waitForTimeout(5000)
    const reviewerTerm = (await page.locator('.pane .term-host').nth(1).getAttribute('data-term-id')) ?? ''
    await feedTerminal(page, reviewerTerm, 'I read the diff and it is mostly fine, apart from some naming.\r\n')
    writeSession(sandbox, 'idle')
    await expect(page.locator('#review-card')).toContainText('could not be read as findings', { timeout: 60_000 })
    await expect(page.locator('.review-card-raw')).toContainText('apart from some naming')
  } finally {
    await closeApp(app)
  }
})

test('All sessions lists the uncommitted changes of the main checkout and each worktree, grouped', async () => {
  test.setTimeout(150_000)
  const sandbox = createSandbox()
  const repo = makeRepo(sandbox)
  const first = join(sandbox.root, 'smoke-wt-one')
  const second = join(sandbox.root, 'smoke-wt-two')
  git(repo, 'worktree', 'add', '-q', '-b', 'one', first)
  git(repo, 'worktree', 'add', '-q', '-b', 'two', second)
  writeFileSync(join(first, 'README.md'), 'hello\nfrom one\n')
  writeFileSync(join(second, 'src', 'a.ts'), 'export const one = 2\n')
  writeFileSync(join(second, 'src', 'extra.ts'), 'export const extra = 1\n')
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    await openReview(page)
    await page.locator('#files-review-scope-all').click()
    await expect(page.locator('.all-group')).toHaveCount(3)
    await expect(page.locator('.all-group').first()).toContainText('Main checkout')
    await expect(page.locator('.all-group').first()).toContainText('README.md')
    await expect(page.locator(`.all-group[aria-label="one"]`)).toContainText('README.md')
    await expect(page.locator(`.all-group[aria-label="two"] .all-row`)).toHaveCount(2)
    await page.locator(`.all-group[aria-label="two"] .all-row[data-path="src/extra.ts"] .files-review-open`).click()
    await expect(page.locator('.files-tab.active')).toContainText('extra.ts')
    await expect(page.locator('#files-review-scope-checkout')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.files-review-row[data-path="src/a.ts"]')).toBeVisible()
  } finally {
    await closeApp(app)
  }
})
