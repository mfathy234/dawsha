import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, openMore, type Sandbox } from '../e2e/helpers'

// Dawsha 1.8.9 site shots: the Mini window start form and the Work view's Today card.
// Generic sample data only: acme-web and billing-api projects, sample session titles.
const SITE = process.env.DAWSHA_SHOTS_OUT ?? resolve(__dirname, '../../site/assets')
const WINDOW = { width: 1440, height: 900 }
// The Work shot is a 1168x668 crop of the main window, not a resize.
// Output is the 1168x668 site size; x is where the crop starts inside the window.
const CROP = { x: 272, y: 0, width: 1168, height: 668 }
// Activity records every 4 minutes keep each session's active spans joined (the gap is 5 minutes).

const ACME = 'acme-web'
const BILLING = 'billing-api'
const MINUTE = 60_000
const BEAT_MS = 4 * MINUTE

const SESSIONS = {
  restore: '2a7f0c10-1b2c-4d3e-8f40-5a6b7c8d9e01',
  dark: '2a7f0c10-1b2c-4d3e-8f40-5a6b7c8d9e02',
  notes: '2a7f0c10-1b2c-4d3e-8f40-5a6b7c8d9e03'
} as const

const line = (record: unknown): string => JSON.stringify(record) + '\n'
const slug = (path: string): string => path.replace(/[^A-Za-z0-9]/g, '-')

function git(folder: string, date: number | null, ...args: string[]): string {
  const when = date === null ? {} : { GIT_AUTHOR_DATE: new Date(date).toISOString(), GIT_COMMITTER_DATE: new Date(date).toISOString() }
  return execFileSync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], {
    cwd: folder,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...when }
  })
}

/** Two sample projects replace the sandbox's Smoke and Missing projects. */
function seedSettings(sandbox: Sandbox, patch: Record<string, unknown>): void {
  const billing = join(sandbox.root, BILLING)
  mkdirSync(billing, { recursive: true })
  const file = join(sandbox.userData, 'settings.json')
  const stored = JSON.parse(readFileSync(file, 'utf8'))
  const projects = [
    { id: ACME, name: ACME, defaultAgent: 'claude', folder: sandbox.projectFolder },
    { id: BILLING, name: BILLING, defaultAgent: 'claude', folder: billing }
  ]
  const recordings = { enabled: false, keepDays: 14, maxMegabytes: 1024 }
  writeFileSync(file, JSON.stringify({ ...stored, onboardingDismissed: true, recordings, projects, ...patch }), 'utf8')
}

async function openMini(app: ElectronApplication, page: Page): Promise<Page> {
  const opened = app.waitForEvent('window')
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mini window' }).click()
  const mini = await opened
  await expect(mini.locator('#mini')).toBeVisible()
  return mini
}

/**
 * Crops the main window in the main process and resizes it to the 1168x668 site size.
 * The crop starts after the project list (x=272), so no half-cut text sits at the left edge; the window is about 1424 wide here, so the
 * crop is resized from 1152 wide to 1168 wide, a 1.4% stretch that is not visible.
 */
async function saveCrop(app: ElectronApplication, page: Page, name: string): Promise<void> {
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: WINDOW.width, height: WINDOW.height } })
  const b64 = await app.evaluate(
    ({ nativeImage }, args: { data: string; left: number; out: { width: number; height: number } }) => {
      const image = nativeImage.createFromBuffer(Buffer.from(args.data, 'base64'))
      const { width } = image.getSize()
      const cropped = image.crop({ x: args.left, y: 0, width: width - args.left, height: args.out.height })
      return cropped.resize({ width: args.out.width, height: args.out.height, quality: 'best' }).toPNG().toString('base64')
    },
    { data: shot.toString('base64'), left: CROP.x, out: { width: CROP.width, height: CROP.height } }
  )
  mkdirSync(SITE, { recursive: true })
  writeFileSync(join(SITE, name), Buffer.from(b64, 'base64'))
}

/** Three sessions that worked today, each with a time window, a branch and commits inside that window. */
function seedTodayWork(sandbox: Sandbox): void {
  const now = Date.now()
  const root = sandbox.projectFolder
  const transcripts = join(sandbox.claudeHome, 'projects', slug(root))
  mkdirSync(transcripts, { recursive: true })

  const sessions = [
    { id: SESSIONS.restore, title: 'Fix the restore bug', branch: 'fix/restore-bug', startMin: 95, endMin: 20, commitMin: 52, usd: 2.31 },
    { id: SESSIONS.dark, title: 'Add a dark mode toggle', branch: 'feat/dark-mode-toggle', startMin: 70, endMin: 35, commitMin: 44, usd: 0.84 },
    { id: SESSIONS.notes, title: 'Write the release notes', branch: 'docs/release-notes', startMin: 30, endMin: 8, commitMin: 14, usd: 0.27 }
  ]
  for (const s of sessions) {
    const start = new Date(now - s.startMin * MINUTE).toISOString()
    const end = new Date(now - s.endMin * MINUTE).toISOString()
    const beats = Array.from({ length: Math.floor((s.startMin - s.endMin) * MINUTE / BEAT_MS) }, (_, n) => ({
      type: 'assistant', timestamp: new Date(now - s.startMin * MINUTE + (n + 1) * BEAT_MS).toISOString(), gitBranch: s.branch, cwd: root, sessionId: s.id,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Working.' }] }
    }))
    writeFileSync(join(transcripts, `${s.id}.jsonl`), [
      { type: 'user', timestamp: start, gitBranch: s.branch, cwd: root, sessionId: s.id, message: { role: 'user', content: s.title } },
      ...beats,
      { type: 'assistant', timestamp: end, gitBranch: s.branch, cwd: root, sessionId: s.id, message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
      { type: 'ai-title', sessionId: s.id, aiTitle: s.title }
    ].map(line).join(''), 'utf8')
  }

  writeFileSync(join(sandbox.userData, 'usage-history.json'), JSON.stringify({
    v: 1,
    limits: [],
    costs: Object.fromEntries(sessions.map((s) => [s.id, { at: now - 1000, usd: s.usd, cwd: root }]))
  }), 'utf8')

  // Repository with a base commit from days ago, then one commit per session on its own branch.
  git(root, now - 3 * 24 * 60 * MINUTE, 'init', '-q', '-b', 'main')
  git(root, null, 'config', 'user.email', 'test@example.invalid')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: ACME, private: true }))
  writeFileSync(join(root, 'restore.ts'), 'export function restore(backup: Backup): void {\n  load(backup)\n}\n')
  writeFileSync(join(root, 'settings.ts'), 'export const theme = "light"\n')
  writeFileSync(join(root, 'RELEASE-NOTES.md'), '# Release notes\n')
  git(root, now - 3 * 24 * 60 * MINUTE, 'add', '.')
  git(root, now - 3 * 24 * 60 * MINUTE, 'commit', '-q', '-m', 'Initial commit')

  git(root, now - 52 * MINUTE, 'checkout', '-q', '-b', 'fix/restore-bug')
  writeFileSync(join(root, 'restore.ts'), 'export function restore(backup: Backup): void {\n  if (!backup.valid) throw new Error("invalid backup")\n  load(backup)\n  notify("restored")\n}\n')
  writeFileSync(join(root, 'restore.test.ts'), 'import { restore } from "./restore"\n\ntest("rejects an invalid backup", () => {\n  expect(() => restore({ valid: false } as Backup)).toThrow()\n})\n')
  git(root, now - 52 * MINUTE, 'add', '.')
  git(root, now - 52 * MINUTE, 'commit', '-q', '-m', 'fix: validate the backup before restore')

  git(root, now - 44 * MINUTE, 'checkout', '-q', '-b', 'feat/dark-mode-toggle', 'main')
  writeFileSync(join(root, 'settings.ts'), 'export const theme = "light"\n\nexport function toggleTheme(current: string): string {\n  return current === "light" ? "dark" : "light"\n}\n')
  writeFileSync(join(root, 'theme.css'), ':root { --bg: #ffffff; }\n[data-theme="dark"] { --bg: #15171a; }\n')
  git(root, now - 44 * MINUTE, 'add', '.')
  git(root, now - 44 * MINUTE, 'commit', '-q', '-m', 'feat: add a dark mode toggle to settings')

  git(root, now - 14 * MINUTE, 'checkout', '-q', '-b', 'docs/release-notes', 'main')
  writeFileSync(join(root, 'RELEASE-NOTES.md'), '# Release notes\n\n## 1.8.9\n\n- Restore checks the backup first.\n- Dark mode toggle in settings.\n- Today card in Work.\n')
  git(root, now - 14 * MINUTE, 'add', '.')
  git(root, now - 14 * MINUTE, 'commit', '-q', '-m', 'docs: 1.8.9 release notes')
  git(root, null, 'checkout', '-q', 'main')
}

test('Mini start form: a project, an agent and a first message typed, before Start', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  seedSettings(sandbox, {})
  const { app, page } = await launchApp(sandbox)
  try {
    const mini = await openMini(app, page)
    await mini.getByRole('button', { name: 'Start a session', exact: true }).click()
    const form = mini.getByRole('form', { name: 'New session' })
    await expect(form).toBeVisible()
    await form.getByLabel('Project').selectOption({ label: ACME })
    await form.getByLabel('Agent').selectOption('claude')
    await form.getByLabel('First message, optional').fill('Add a dark mode toggle to settings')
    await expect(form.getByLabel('First message, optional')).toHaveValue('Add a dark mode toggle to settings')
    await mini.mouse.move(1, 1)
    await mini.waitForTimeout(800)
    await mini.locator('#mini').screenshot({ path: join(SITE, 'mini-start.png') })
    await mini.close().catch(() => undefined)
  } finally {
    await closeApp(app)
  }
})

test('Work Today card: three sessions with time, files committed, cost and the total line', async () => {
  test.setTimeout(240_000)
  const sandbox = createSandbox()
  seedSettings(sandbox, {})
  seedTodayWork(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await openMore(page, 'work')
    const card = page.locator('#work-today')
    await expect(card.locator('.today-row')).toHaveCount(3, { timeout: 30_000 })
    await expect(card.locator('.today-row').first()).toContainText('Fix the restore bug')
    await expect(page.locator('#work-today-total')).toContainText('committed')
    await expect(page.locator('#work-today-total')).toContainText('$3.42')
    await page.mouse.move(WINDOW.width - 4, WINDOW.height - 4)
    await page.waitForTimeout(800)
    await saveCrop(app, page, 'work-today.png')
  } finally {
    await closeApp(app)
  }
})
