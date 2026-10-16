import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp, type Sandbox } from './helpers'
import { OrchStore } from '../../src/main/orch/store'

const SHOTS = 'C:/Users/tuy_2/Desktop/work-dashboard-shots'
const id = (n: number) => `11111111-2222-4333-8444-${String(n).padStart(12, '0')}`
const lines = (...records: unknown[]) => records.map(r => JSON.stringify(r)).join('\n') + '\n'
function seed(s: Sandbox): void {
  const end = new Date(Date.now() - 1000).toISOString()
  const start = new Date(Date.now() - 61_000).toISOString()
  const dir = join(s.claudeHome, 'projects', s.projectFolder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  for (const [n, title, branch] of [[1, 'Build stock service', 'feature/26412-stock'], [2, 'Repair login', 'fix/18550'], [3, 'Discuss architecture', 'main']] as const) {
    writeFileSync(join(dir, `${id(n)}.jsonl`), lines(
      { type: 'user', timestamp: start, gitBranch: branch, message: { content: title } },
      { type: 'assistant', timestamp: end, gitBranch: branch, message: { content: [{ type: 'text', text: 'Done' }] } },
      { type: 'ai-title', aiTitle: title }
    ))
  }
  const codexDir = join(s.codexHome, 'sessions', '2026', '10', '16')
  mkdirSync(codexDir, { recursive: true })
  writeFileSync(join(codexDir, `rollout-2026-10-16T10-00-00-${id(4)}.jsonl`), lines(
    { type: 'session_meta', payload: { id: id(4), cwd: s.projectFolder, timestamp: start, git: { branch: 'feat/123-chart' } } },
    { type: 'event_msg', timestamp: end, payload: { type: 'user_message', message: 'Build chart' } }
  ))
  const geminiDir = join(s.geminiHome, 'tmp', 'work')
  mkdirSync(join(geminiDir, 'chats'), { recursive: true })
  writeFileSync(join(geminiDir, '.project_root'), s.projectFolder)
  writeFileSync(join(geminiDir, 'chats', 'session-2026-10-16-work.jsonl'), lines(
    { sessionId: id(5), startTime: start, lastUpdated: end }, { id: 'm', type: 'user', content: 'Explore options', timestamp: end }
  ))
  const settings = JSON.parse(readFileSync(join(s.userData, 'settings.json'), 'utf8'))
  const other = join(s.root, 'Other')
  mkdirSync(other, { recursive: true })
  settings.projects.push({ id: 'other', name: 'Other', folder: other })
  writeFileSync(join(s.userData, 'settings.json'), JSON.stringify(settings))
  const otherDir = join(s.claudeHome, 'projects', other.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(otherDir, { recursive: true })
  writeFileSync(join(otherDir, `${id(6)}.jsonl`), lines(
    { type: 'user', timestamp: start, message: { content: 'Discuss roadmap' } },
    { type: 'assistant', timestamp: end, message: { content: 'Done' } }
  ))
}

function seedRuns(s: Sandbox, enabled = true): void {
  const settings = JSON.parse(readFileSync(join(s.userData, 'settings.json'), 'utf8'))
  settings.experimental = { orchestrator: enabled }
  writeFileSync(join(s.userData, 'settings.json'), JSON.stringify(settings))
  const store = new OrchStore(join(s.userData, 'orchestrator.db'))
  for (const kind of ['feature', 'bug'] as const) store.putRun({ id: `run_${kind === 'feature' ? 'abcdefgh' : 'ijklmnop'}`, title: `${kind} orchestrator item`, kind,
    projectId: 'smoke', projectPath: s.projectFolder, createdAt: Date.now() - 61_000, finishedAt: Date.now() - 1000, story: 'Test work history', plan: '', stage: 'done' })
  for (const [n, runner] of [[1, 'claude'], [5, 'gemini']] as const) store.putAgent({ id: `a${n}`, runId: 'run_abcdefgh', role: 'lead', runner, model: '', token: `test-token-${n}`,
    taskId: null, createdAt: Date.now() - 61_000, retiredAt: Date.now() - 1000, usage: null,
    launch: { agent: runner, args: ['--session-id', id(n)], env: {}, files: [] } })
  store.close()
  const dir = join(s.codexHome, 'sessions', '2026', '10', '16')
  const path = join(dir, `rollout-2026-10-16T10-00-00-${id(4)}.jsonl`)
  writeFileSync(path, readFileSync(path, 'utf8').replace('feat/123-chart', 'orch/abcdefgh/t-1'))
}

test('work dashboard counts agent sessions, filters projects, resumes and supports calendar periods in both themes', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: sandbox.projectFolder, windowsHide: true,
    env: { ...process.env, GIT_AUTHOR_DATE: new Date(Date.now() - 30_000).toISOString(), GIT_COMMITTER_DATE: new Date(Date.now() - 30_000).toISOString() } })
  git('init', '-q', '-b', 'main')
  // Like a real repo: the user's email is configured, so only their own commits count.
  git('config', 'user.email', 'test@example.invalid')
  git('commit', '--allow-empty', '-qm', 'docs: explain architecture')
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'Work', exact: true }).click()
    const view = page.getByRole('main', { name: 'Work dashboard' })
    await expect(view).toBeVisible()
    await expect(page.locator('#work-total .usage-tile-value')).toHaveText('6')
    await expect(page.locator('#work-feature .usage-tile-value')).toHaveText('2')
    await expect(page.locator('#work-bug .usage-tile-value')).toHaveText('1')
    await expect(page.locator('#work-other .usage-tile-value')).toHaveText('2')
    await expect(page.locator('#work-conversation .usage-tile-value')).toHaveText('1')
    await expect(page.locator('.work-item')).toHaveCount(6)
    await expect(page.locator('#work-by-project tbody tr').first().locator('td')).toHaveText(['Smoke', '2', '1', '2', '0', '5', /5m/])
    await expect(view).toContainText('#26412')
    await expect(view).toContainText('#18550')
    await expect(view).toContainText('Codex')
    await expect(view).toContainText('Gemini')
    mkdirSync(SHOTS, { recursive: true })
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') {
        await page.locator('#theme-button').click()
        await page.locator('#theme-dawsha-daylight').click()
        await page.keyboard.press('Escape')
      }
      for (const period of ['Today', 'This week']) {
        await view.getByRole('tab', { name: period, exact: true }).click()
        await expect(view).toHaveAttribute('aria-busy', 'false')
        await expect(page.locator('#work-total .usage-tile-value')).toHaveText('6')
        await page.screenshot({ path: join(SHOTS, `${theme}-${period === 'Today' ? 'today' : 'week'}.png`), animations: 'disabled' })
      }
    }
    await expect(view.locator('.usage-col')).toHaveCount(7)
    await view.getByRole('tab', { name: 'This month' }).click()
    await expect(view.locator('.usage-col')).toHaveCount(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate())
    await view.getByRole('button', { name: 'Filter by Other', exact: true }).click()
    await expect(view.locator('.work-item')).toHaveCount(1)
    await view.getByRole('button', { name: 'All projects', exact: true }).click()
    await expect(view.locator('.work-item')).toHaveCount(6)
    await view.getByRole('button', { name: /Build stock service/ }).click()
    await expect(view).toBeHidden()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).workspace?.panes?.[0]?.tabs?.[0]?.sessionId).toBe(id(1))
  } finally { await closeApp(app) }
})

test('counts each orchestrator run once, excludes child sessions of all agents, and opens its run', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  seedRuns(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#work-button').click()
    await expect(page.locator('#work-total .usage-tile-value')).toHaveText('5')
    await expect(page.locator('#work-feature .usage-tile-value')).toHaveText('1')
    await expect(page.locator('#work-bug .usage-tile-value')).toHaveText('2')
    await expect(page.locator('.work-item').filter({ hasText: 'Build stock service' })).toHaveCount(0)
    await expect(page.locator('.work-item').filter({ hasText: 'Explore options' })).toHaveCount(0)
    await expect(page.locator('.work-item').filter({ hasText: 'Build chart' })).toHaveCount(0)
    await page.locator('.work-item').filter({ hasText: 'feature orchestrator item' }).click()
    await expect(page.locator('.orch-run')).toBeVisible()
    await expect(page.locator('.orch-run')).toContainText('feature orchestrator item')
  } finally { await closeApp(app) }
})

test('opens persisted runs read-only while the orchestrator remains disabled', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  seedRuns(sandbox, false)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#work-button').click()
    await page.locator('.work-item').filter({ hasText: 'feature orchestrator item' }).click()
    const dialog = page.getByRole('dialog', { name: 'feature orchestrator item' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Test work history')
    await expect(dialog).toContainText('done')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).experimental.orchestrator).toBe(false)
  } finally { await closeApp(app) }
})

test('work dashboard explains an empty period and can return to sessions', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'Work', exact: true }).click()
    await expect(page.locator('.work-view')).toContainText('No work in this period')
    await expect(page.locator('#work-total .usage-tile-value')).toHaveText('0')
    await page.locator('#sessions-button').click()
    await expect(page.locator('.work-view')).toBeHidden()
  } finally { await closeApp(app) }
})

test('the Tickets tab counts a branch once and keeps the name and link the user gives it', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'Work', exact: true }).click()
    await page.getByRole('tab', { name: 'Tickets', exact: true }).click()
    const row = page.locator('.work-ticket-row', { hasText: '#18550' })
    await expect(row).toBeVisible()
    await expect(row.locator('.work-ticket-head .work-chip')).toHaveText('Bug')
    await expect(row).toContainText('1 session')
    // A web link only: anything else is refused with a message.
    await row.getByRole('button', { name: 'Edit' }).click()
    await row.getByLabel('Ticket name').fill('Login crash on expired token')
    await row.getByLabel('Ticket link').fill('javascript:alert(1)')
    await row.getByRole('button', { name: 'Save' }).click()
    await expect(row.getByRole('alert')).toContainText('web address')
    // What was typed survives the error.
    await expect(row.getByLabel('Ticket name')).toHaveValue('Login crash on expired token')
    await row.getByLabel('Ticket link').fill('dev.azure.com/MicrotecEgypt/_workitems/edit/18550')
    await row.getByRole('button', { name: 'Save' }).click()
    await expect(row.locator('.work-ticket-name')).toHaveText('Login crash on expired token')
    await expect(row.getByRole('link', { name: 'Open link ↗' })).toHaveAttribute('href', 'https://dev.azure.com/MicrotecEgypt/_workitems/edit/18550')
    await expect.poll(() => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')).ticketNotes, { timeout: 10_000 })
      .toEqual(expect.objectContaining({ [String(await row.getAttribute('data-ticket'))]: { name: 'Login crash on expired token', link: 'https://dev.azure.com/MicrotecEgypt/_workitems/edit/18550' } }))
    mkdirSync('test-results/screens', { recursive: true })
    await page.screenshot({ path: 'test-results/screens/work-tickets.png' })
  } finally {
    await closeApp(app)
  }
})

test('steps back and forward through days, weeks and months', async () => {
  const sandbox = createSandbox()
  seed(sandbox)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'Work', exact: true }).click()
    const label = page.locator('#work-period-label')
    const total = page.locator('#work-total .usage-tile-value')
    await expect(label).toHaveText('Today')
    await expect(total).not.toHaveText('0')
    await expect(page.locator('#work-next')).toBeDisabled()
    // The seeded work is today: yesterday is empty, and coming back shows it again.
    await page.locator('#work-prev').click()
    await expect(label).toHaveText('Yesterday')
    await expect(total).toHaveText('0')
    await page.locator('#work-prev').click()
    await expect(label).not.toHaveText('Yesterday')
    await page.locator('#work-next').click()
    await page.locator('#work-next').click()
    await expect(label).toHaveText('Today')
    await expect(total).not.toHaveText('0')
    // A past week shows its dates; switching period goes back to now.
    await page.getByRole('tab', { name: 'This week', exact: true }).click()
    await page.locator('#work-prev').click()
    await expect(label).toHaveText(/\S+ \d+ – \S+ \d+/)
    await page.getByRole('tab', { name: 'This month', exact: true }).click()
    await expect(label).toHaveText('This month')
  } finally {
    await closeApp(app)
  }
})
