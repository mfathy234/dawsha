import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { activeTermId, bufferText, closeApp, createSandbox, launchApp, type Sandbox } from '../e2e/helpers'

// Dawsha 1.9.0 site shots: the Files review panel with two comments, a worktree session running its setup,
// and a session whose pull request has failing checks with its PR menu open.
// Generic sample data only: an invoice-api project and sample branch names. No user path reaches a shot.
const SITE = process.env.DAWSHA_SHOTS_OUT ?? resolve(__dirname, '../../site/assets')
const WINDOW = { width: 1440, height: 900 }
// Each shot is a 1168x668 crop of the 1440x900 main window, taken at native size (no resize).
const CROP = { width: 1168, height: 668 }

const AGENT = { DAWSHA_CLAUDE_COMMAND: process.execPath, DAWSHA_CLAUDE_ARGS: JSON.stringify([resolve(__dirname, '../support/fakeAgent.cjs'), 'claude']) }
const PROJECT = 'invoice-api'
const SESSION = '3c9e1f20-7a4b-4d8e-9b11-0f2a6c5d7e01'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

const settingsFile = (sandbox: Sandbox): string => join(sandbox.userData, 'settings.json')
const readSettings = (sandbox: Sandbox): any => JSON.parse(readFileSync(settingsFile(sandbox), 'utf8'))
/** The sample repository folder is named after the project, so the header shows invoice-api. */
const projectFolder = (sandbox: Sandbox): string => {
  const folder = join(sandbox.root, PROJECT)
  mkdirSync(folder, { recursive: true })
  return folder
}

/** Renames the sample project and drops the sandbox's second project, so only invoice-api shows. */
function seedSettings(sandbox: Sandbox, patch: (settings: any) => any = (settings) => settings): void {
  const stored = readSettings(sandbox)
  const projects = stored.projects
    .filter((project: any) => project.id !== 'gone')
    .map((project: any) => (project.id === 'smoke' ? { ...project, name: PROJECT, folder: projectFolder(sandbox) } : project))
  writeFileSync(settingsFile(sandbox), JSON.stringify(patch({ ...stored, onboardingDismissed: true, projects })), 'utf8')
}

/** Saves a 1168x668 crop of the main window, starting at (left, top). */
async function saveCrop(app: ElectronApplication, page: Page, name: string, left: number, top = 0): Promise<void> {
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: WINDOW.width, height: WINDOW.height } })
  const b64 = await app.evaluate(
    ({ nativeImage }, args: { data: string; left: number; top: number; width: number; height: number }) => {
      const image = nativeImage.createFromBuffer(Buffer.from(args.data, 'base64'))
      return image.crop({ x: args.left, y: args.top, width: args.width, height: args.height }).toPNG().toString('base64')
    },
    { data: shot.toString('base64'), left, top, width: CROP.width, height: CROP.height }
  )
  mkdirSync(SITE, { recursive: true })
  writeFileSync(join(SITE, name), Buffer.from(b64, 'base64'))
}

// ---------- 1. Review comments ----------

function makeInvoiceRepo(folder: string): void {
  mkdirSync(join(folder, 'src', 'invoice'), { recursive: true })
  git(folder, 'init', '-q', '-b', 'main')
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: PROJECT, version: '0.4.0', private: true }, null, 2) + '\n')
  writeFileSync(join(folder, 'src', 'invoice', 'totals.ts'), [
    'export interface LineItem { qty: number; unitPrice: number; taxRate: number }',
    '',
    'export function lineTotal(item: LineItem): number {',
    '  return Math.round(item.qty * item.unitPrice * (1 + item.taxRate) * 100) / 100',
    '}',
    '',
    'export function invoiceTotal(items: LineItem[]): number {',
    '  return items.reduce((sum, item) => sum + lineTotal(item), 0)',
    '}',
    ''
  ].join('\n'))
  git(folder, 'add', '.')
  git(folder, 'commit', '-q', '-m', 'Add invoice totals')
  // The session's uncommitted change: rounding moves to the end of the invoice.
  writeFileSync(join(folder, 'src', 'invoice', 'totals.ts'), [
    'export interface LineItem { qty: number; unitPrice: number; taxRate: number }',
    '',
    'export function lineTotal(item: LineItem): number {',
    '  return item.qty * item.unitPrice * (1 + item.taxRate)',
    '}',
    '',
    'export function invoiceTotal(items: LineItem[]): number {',
    '  const total = items.reduce((sum, item) => sum + lineTotal(item), 0)',
    '  return Math.round(total * 100) / 100',
    '}',
    ''
  ].join('\n'))
}

async function commentOn(page: Page, file: string, line: number, text: string): Promise<void> {
  await page.locator(`.files-review-row[data-path="${file}"] .files-review-open`).click()
  await page.locator(`.files-editor:not([hidden]) .cm-review-add[aria-label="Add a review comment on line ${line}"]`).click()
  await page.locator('.cm-review-input').fill(text)
  await page.keyboard.press('Control+Enter')
  await expect(page.locator('.cm-review-text').last()).toHaveText(text)
}

test('Files review: a session diff with two comment drafts and the send button', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  makeInvoiceRepo(projectFolder(sandbox))
  seedSettings(sandbox)
  const { app, page } = await launchApp(sandbox, AGENT)
  try {
    await page.setViewportSize(WINDOW)
    await page.getByRole('button', { name: `New Claude session in ${PROJECT}`, exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await page.locator('#files-button').click()
    await expect(page.locator('#files-view')).toBeVisible()
    await page.locator('#files-mode-review').click()
    await expect(page.locator('.files-review-row[data-path="src/invoice/totals.ts"]')).toBeVisible({ timeout: 30_000 })
    await commentOn(page, 'src/invoice/totals.ts', 4, 'Round once at the end, not per line')
    await commentOn(page, 'src/invoice/totals.ts', 9, 'This needs a test for an empty invoice')
    await expect(page.locator('#files-comments-head')).toContainText('Comments (2)')
    await expect(page.locator('#files-review-send')).toHaveText('Send 2 comments to Claude')
    await page.mouse.move(WINDOW.width - 2, WINDOW.height - 2)
    await page.waitForTimeout(800)
    await saveCrop(app, page, 'review-comments.png', 0, 222)
  } finally {
    await closeApp(app)
  }
})

// ---------- 2. Worktree setup ----------

/** A fake npm on PATH prints npm ci-like lines and then keeps running, so the agent waits behind it. */
function fakeNpm(sandbox: Sandbox): string {
  const bin = join(sandbox.root, 'fake-bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'npm.cmd'), [
    '@echo off',
    'echo added 412 packages, and audited 413 packages in 9s',
    'echo found 0 vulnerabilities',
    'echo.',
    'echo ^> invoice-api@0.4.0 prepare',
    'echo ^> husky',
    'ping -n 600 127.0.0.1 >nul',
    ''
  ].join('\r\n'), 'utf8')
  return bin
}

test('Worktree setup: a new session in its own worktree runs npm ci before the agent starts', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  const repo = projectFolder(sandbox)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n.env\n')
  writeFileSync(join(repo, '.env'), 'DATABASE_URL=local\n')
  writeFileSync(join(repo, '.worktreeinclude'), '.env\n')
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: PROJECT, version: '0.4.0', private: true }, null, 2) + '\n')
  writeFileSync(join(repo, 'README.md'), '# invoice-api\n')
  git(repo, 'add', '.gitignore', 'package.json', 'README.md', '.worktreeinclude')
  git(repo, 'commit', '-q', '-m', 'Initial commit')
  seedSettings(sandbox, (settings) => ({
    ...settings,
    projects: settings.projects.map((project: any) => (project.id === 'smoke' ? { ...project, worktreeSetup: { command: 'npm ci', prompted: true } } : project))
  }))
  const pathBefore = process.env.PATH
  process.env.PATH = `${fakeNpm(sandbox)};${pathBefore ?? ''}`
  const { app, page } = await launchApp(sandbox, AGENT)
  try {
    await page.setViewportSize(WINDOW)
    await page.locator('#new-session').click()
    await page.getByRole('checkbox', { name: 'Use its own worktree', exact: true }).check()
    await page.getByRole('button', { name: `Start Claude in ${PROJECT}`, exact: true }).click()
    await expect.poll(() => page.locator('.term-host.active').count()).toBeGreaterThan(0)
    const id = await activeTermId(page)
    await expect.poll(() => bufferText(page, id), { timeout: 60_000 }).toContain('added 412 packages')
    expect(await bufferText(page, id)).not.toContain('READY claude')
    await page.mouse.move(WINDOW.width - 2, WINDOW.height - 2)
    await page.waitForTimeout(800)
    await saveCrop(app, page, 'worktree-setup.png', 272, 48)
  } finally {
    process.env.PATH = pathBefore
    await closeApp(app)
  }
})

// ---------- 3. Pull request checks failed, PR menu open ----------

const FAKE_GH = `
const args = process.argv.slice(2)
const check = (name, conclusion) => ({ __typename: 'CheckRun', name, workflowName: 'CI', status: 'COMPLETED', conclusion, detailsUrl: 'https://github.com/example/invoice-api/actions/runs/4242/job/1' })
if (args[0] === 'pr' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({
    number: 34, title: 'Round invoice totals once', url: 'https://github.com/example/invoice-api/pull/34', state: 'OPEN', isDraft: false,
    mergeStateStatus: 'UNSTABLE', reviewDecision: '', headRefOid: process.env.FAKE_GH_HEAD, headRefName: 'feature/invoice-totals', baseRefName: 'main',
    statusCheckRollup: [check('build', 'FAILURE'), check('test', 'FAILURE'), check('lint', 'SUCCESS')]
  }))
} else {
  process.stderr.write('unexpected call: ' + args.join(' ') + '\\n')
  process.exit(2)
}
`

test('PR watch: checks failed (2) in the footer, with the PR menu open', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  const repo = projectFolder(sandbox)
  makeInvoiceRepo(repo)
  git(repo, 'checkout', '-q', '-b', 'feature/invoice-totals')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Round invoice totals once')
  const head = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'checkout', '-q', 'main')
  const tree = `${repo}-pr-wt`
  git(repo, 'worktree', 'add', '-q', tree, 'feature/invoice-totals')
  const ghScript = join(sandbox.root, 'fake-gh.cjs')
  writeFileSync(ghScript, FAKE_GH, 'utf8')

  const settings = readSettings(sandbox)
  writeFileSync(settingsFile(sandbox), JSON.stringify({
    ...settings,
    projects: settings.projects.map((project: any) => (project.id === 'smoke' ? { ...project, name: PROJECT, folder: repo } : project)).filter((project: any) => project.id !== 'gone'),
    onboardingDismissed: true,
    pullRequests: { smoke: { mergeCommand: '', mergeConfirmed: false, tidyUp: true } },
    workspace: { focusedIndex: 0, panes: [{ projectId: 'smoke', folder: tree, worktree: { repo, path: tree, branch: 'feature/invoice-totals' }, tabs: [{ agent: 'claude', label: 'claude', sessionId: SESSION }], activeIndex: 0, fontSize: 13 }] }
  }), 'utf8')

  const { app, page } = await launchApp(sandbox, { ...AGENT, DAWSHA_GH_SCRIPT: ghScript, FAKE_GH_HEAD: head, DAWSHA_PR_POLL_SPEED: '40' })
  try {
    await page.setViewportSize(WINDOW)
    const pane = page.locator('.pane').first()
    await expect(pane).toBeVisible({ timeout: 30_000 })
    const footer = pane.locator('.pane-pr')
    await expect(footer).toHaveText('PR #34: checks failed (2)', { timeout: 30_000 })
    await expect(page.locator('.sess-row').first()).toContainText('PR #34: checks failed (2)')
    await footer.click()
    await expect(page.getByRole('menuitem', { name: /^Fix CI(?! automatically)/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Merge when green/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Tidy up after a merge/ })).toBeVisible()
    await page.waitForTimeout(500)
    await saveCrop(app, page, 'pr-watch.png', 272, 232)
  } finally {
    await closeApp(app)
  }
})
