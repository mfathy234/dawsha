import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { OrchRunDetail } from '../../src/shared/orch/api'
import { APP_VERSION, closeApp, createSandbox, launchApp } from './helpers'

const FAKE_ORCH = resolve(__dirname, '../support/fakeOrchAgent.cjs')
const SCREENS = 'test-results/screens'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: join(SCREENS, `orch-${name}.png`), animations: 'disabled' })

for (const theme of ['dawsha-night', 'dawsha-daylight']) {
  test(`run stages show accessible progress and wrap without controls in ${theme}`, async () => {
    const sandbox = createSandbox()
    writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
      version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true,
      theme: { id: theme }, experimental: { orchestrator: true }
    }))
    const { app, page } = await launchApp(sandbox)
    // Supply run states at the IPC boundary; render the real dashboard and theme CSS.
    const publish = async (kind: OrchRunDetail['kind'], stage: OrchRunDetail['stage']): Promise<void> => {
      const run: OrchRunDetail = {
        id: 'stage-track', kind, stage, title: 'Progress track', projectId: null,
        createdAt: 1, taskCount: 0, tasksDone: 0, openDecisions: 0,
        story: '', plan: 'Budget', projectPath: '', finishedAt: null, branch: '',
        tasks: [], agents: [], events: [],
        usage: { agents: [], byRole: [], total: { inputTokens: 0, outputTokens: 0,
          cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: 0, complete: true } }
      }
      await app.evaluate(({ ipcMain, webContents }, value) => {
        ipcMain.removeHandler('orch:snapshot')
        ipcMain.handle('orch:snapshot', () => ({
          status: { enabled: true, running: true, error: null }, runs: [value], decisions: []
        }))
        for (const contents of webContents.getAllWebContents()) contents.send('orch:changed')
      }, run)
    }
    try {
      await publish('bug', 'build')
      await page.locator('#orchestrator-button').click()
      await page.getByRole('button', { name: 'Open', exact: true }).click()
      const track = page.getByRole('list', { name: 'Stages', exact: true })
      const items = track.locator('li:not(.cancelled)')
      for (const kind of ['bug', 'feature'] as const) {
        const labels = kind === 'bug' ? ['Build', 'Merge', 'Done'] : ['Spec', 'Plan', 'Build', 'Merge', 'Done']
        const stages = kind === 'bug' ? ['build', 'review', 'merge', 'done', 'cancelled'] as const
          : ['spec', 'plan', 'build', 'review', 'merge', 'done', 'cancelled'] as const
        for (const stage of stages) {
          await publish(kind, stage)
          const at = labels.indexOf(stage === 'review' ? 'Build' : stage[0].toUpperCase() + stage.slice(1))
          const states = labels.map((_, i) => stage === 'done' ? 'done' : i < at ? 'done' : i === at ? 'current' : 'upcoming')
          await expect(items).toHaveText(labels.map((label, i) => `${label} (${states[i]})`))
          await expect(track.locator('[aria-current="step"]')).toHaveCount(stage === 'done' || stage === 'cancelled' ? 0 : 1)
          await expect(track.locator('button, a, [tabindex]')).toHaveCount(0)
          const first = items.first()
          await expect(first).toHaveCSS('border-top-width', '0px')
          await expect(first).toHaveCSS('cursor', 'default')
          await expect(first.locator('i')).toHaveAttribute('aria-hidden', 'true')
          await expect(first.locator('i')).toHaveCSS('width', '10px')
          await expect(first.locator('i')).toHaveCSS('height', '10px')
          const colors = await track.evaluate((el) => {
            const probe = document.createElement('span')
            el.append(probe)
            const color = (token: string): string => {
              probe.style.color = `var(--${token})`
              return getComputedStyle(probe).color
            }
            const result = { accent: color('accent'), border: color('border'), text: color('text'), muted: color('muted'), danger: color('danger') }
            probe.remove()
            return result
          })
          for (let i = 0; i < labels.length; i++) {
            const item = items.nth(i)
            const state = states[i]
            await expect(item).toHaveCSS('color', state === 'done' ? colors.accent : state === 'current' ? colors.text : colors.muted)
            await expect(item.locator('i')).toHaveCSS('border-top-color', state === 'upcoming' ? colors.border : colors.accent)
            if (state === 'current') await expect(item).toHaveCSS('font-weight', '600')
            if (i < labels.length - 1) {
              const connector = await item.evaluate((el) => {
                const css = getComputedStyle(el, '::after')
                return { height: css.height, color: css.backgroundColor }
              })
              expect(connector).toEqual({ height: '2px', color: state === 'done' ? colors.accent : colors.border })
            }
          }
          if (stage === 'cancelled') {
            await expect(track.getByText('Cancelled', { exact: true })).toHaveCSS('color', colors.danger)
            await expect(track.getByText('Cancelled', { exact: true })).toHaveCSS('border-top-width', '0px')
          }
        }
        await publish(kind, 'merge')
        await expect(track.locator('[aria-current="step"]')).toContainText('Merge')
        for (const width of [1440, 520]) {
          await page.setViewportSize({ width, height: 900 })
          const bounds = await items.evaluateAll((els) => els.map((el) => {
            const r = el.getBoundingClientRect()
            return { top: r.top, left: r.left, right: r.right }
          }))
          if (width === 1440) expect(new Set(bounds.map((r) => r.top)).size).toBe(1)
          expect(await track.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
          for (let i = 1; i < bounds.length; i++) {
            expect(bounds[i].top > bounds[i - 1].top || bounds[i].left >= bounds[i - 1].right).toBe(true)
          }
        }
        await page.setViewportSize({ width: 1440, height: 900 })
        mkdirSync(SCREENS, { recursive: true })
        await shot(page, `stage-track-${kind}-${theme}`)
      }
    } finally { await closeApp(app) }
  })
}

test('Settings → Orchestrator edits plans and profiles, and the view works in a light theme', async () => {
  test.setTimeout(60_000)
  mkdirSync(SCREENS, { recursive: true })
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    version: 2,
    lastSeenVersion: APP_VERSION,
    onboardingDismissed: true,
    theme: { id: 'dawsha-daylight' },
    experimental: { orchestrator: true },
    projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }]
  }))
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#orchestrator-button').click()
    await page.locator('#orch-tab-new').click()
    await expect(page.locator('#orch-nr-plans')).toContainText('Budget')
    await shot(page, 'light-new-run-feature')
    await page.locator('#orch-nr-open-plans').click()
    await expect(page.locator('.settings-view')).toContainText('Lead')
    await expect(page.locator('.settings-view')).toContainText('Prices')
    await shot(page, 'light-settings')
  } finally {
    await closeApp(app)
  }
})

test('fix a bug from the Orchestrator view and finish it in Human review', async () => {
  test.setTimeout(120_000)
  mkdirSync(SCREENS, { recursive: true })
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    version: 2,
    lastSeenVersion: APP_VERSION,
    onboardingDismissed: true,
    experimental: { orchestrator: true },
    projects: [{ id: 'smoke', name: 'Smoke', folder: repo }]
  }))
  const { app, page } = await launchApp(sandbox, {
    DAWSHA_CLAUDE_COMMAND: process.execPath,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([FAKE_ORCH])
  })
  try {
    // The top bar has an Orchestrator button; the view starts empty.
    await page.locator('#orchestrator-button').click()
    await expect(page.locator('.orch-view')).toBeVisible()
    await expect(page.locator('.orch-view')).toContainText('Start a run')
    await shot(page, 'empty')

    // New run: a bug, fixed by the plan's main model.
    await page.locator('#orch-tab-new').click()
    await page.locator('#orch-nr-kind').getByText('Bug', { exact: true }).click()
    await page.locator('#orch-nr-story').fill('The export button crashes when the range is empty.')
    await page.locator('#orch-nr-title').fill('Export crashes on an empty range')
    await shot(page, 'new-run-bug')
    await page.locator('#orch-nr-start').click()

    // The fixer opens as a pane; the run finishes building and asks the human to mark it done.
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    // Starting a run already shows its dashboard; the top bar button toggles the view, so only open it if hidden.
    if (!(await page.locator('.orch-view').isVisible())) await page.locator('#orchestrator-button').click()
    await expect(page.locator('.orch-view')).toBeVisible()
    await expect(page.locator('.orch-view')).toContainText('Export crashes on an empty range')
    await expect(page.locator('#orchestrator-button .orch-badge')).toHaveText('1', { timeout: 60_000 })
    const story = page.locator('.orch-story')
    await expect(story.locator('summary')).toContainText('The export button crashes when the range is empty.')
    await expect(story).not.toHaveAttribute('open', '')
    await story.locator('summary').click()
    await expect(story.locator('.orch-story-text')).toBeVisible()
    await story.locator('summary').click()
    await expect(page.locator('.orch-ev time').first()).toHaveCSS('white-space', 'nowrap')
    expect(await page.locator('.orch-card .orch-model').first().evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.setViewportSize({ width: 1050, height: 900 })
    const board = await page.locator('.orch-tasks').boundingBox()
    const side = await page.locator('.orch-side').boundingBox()
    expect(side!.y).toBeGreaterThanOrEqual(board!.y + board!.height)
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('.orch-card').first()).toBeInViewport()
    await shot(page, 'run-dashboard')

    await page.locator('#orch-tab-runs').click()
    await expect(page.locator('.orch-view')).toContainText('Run finished')
    await shot(page, 'all-runs')

    await page.locator('#orch-tab-boards').click()
    // The completed fixer is in Done; the default Open filter hides it.
    await page.locator('.orch-filter').filter({ hasText: /^Status/ }).locator('select').selectOption('all')
    await expect(page.locator('.orch-view')).toContainText('T-1')
    await shot(page, 'boards')

    await page.locator('#orch-tab-review').click()
    await expect(page.locator('.orch-view')).toContainText('is finished on branch orch/')
    await shot(page, 'review')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('#orchestrator-button .orch-badge')).toBeHidden({ timeout: 15_000 })
    await expect(page.locator('.orch-view')).toContainText('Nothing needs you right now')
  } finally {
    await closeApp(app)
  }
})

test('orchestrator gives text room and respects motion preferences in both themes', async () => {
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true,
    experimental: { orchestrator: true }, projects: [{ id: 'smoke', name: 'Smoke', folder: sandbox.projectFolder }]
  }))
  const { app, page } = await launchApp(sandbox)
  try {
    await page.setViewportSize({ width: 1800, height: 1000 })
    await page.locator('#orchestrator-button').click()
    for (const theme of ['grid-dark', 'dawsha-daylight']) {
      await page.locator('#theme-button').click()
      await page.locator(`#theme-${theme}`).click()
      await page.keyboard.press('Escape')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.locator('#orch-tab-new').click()
      const column = page.locator('.orch-nr')
      await expect(column).toHaveCSS('max-width', '1200px')
      await expect(page.locator('.orch-nr-form')).toHaveCSS('padding', '20px')
      await expect(page.locator('.orch-view')).toHaveCSS('font-size', '13px')
      await expect(page.locator('.orch-title')).toHaveCSS('font-size', '20px')
      const bounds = await column.boundingBox()
      const center = await page.locator('.orch-body').evaluate((el) => el.getBoundingClientRect().left + el.clientWidth / 2)
      expect(Math.abs(bounds!.x + bounds!.width / 2 - center)).toBeLessThan(2)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.locator('#orch-tab-history').click()
      await expect(page.locator('.orch-history')).toHaveCSS('animation-duration', '0.12s')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect(page.locator('.orch-history')).toHaveCSS('animation-name', 'none')
    }
  } finally { await closeApp(app) }
})

test('toasts keep the newest three and dismiss info before errors', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'))
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      for (const [message, ok] of [['old info', true], ['persistent error', false], ['new info', true], ['newest info', true]] as const) {
        window.webContents.send('cli:notice', message, ok)
      }
    })
    await expect(page.locator('.toast')).toHaveText(['persistent error', 'new info', 'newest info'])
    await page.clock.fastForward(3999)
    await expect(page.locator('.toast.info')).toHaveCount(2)
    await page.clock.fastForward(1)
    await expect(page.locator('.toast.info')).toHaveCount(0)
    await expect(page.locator('.toast.error')).toHaveText('persistent error')
    await page.clock.fastForward(3000)
    await expect(page.locator('.toast')).toHaveCount(0)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('cli:notice', 'Dismiss me', true))
    await page.locator('.toast').click()
    await expect(page.locator('.toast')).toHaveCount(0)
  } finally { await closeApp(app) }
})

test('empty stories are hidden and long stories have a collapsed preview', async () => {
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true, experimental: { orchestrator: true }
  }))
  const { app, page } = await launchApp(sandbox)
  const publish = async (story: string): Promise<void> => {
    const run: OrchRunDetail = {
      id: 'story-preview', kind: 'bug', stage: 'done', title: 'Story preview', projectId: null,
      createdAt: 1, taskCount: 0, tasksDone: 0, openDecisions: 0,
      story, plan: 'Budget', projectPath: '', finishedAt: 2, branch: '', tasks: [], agents: [], events: [],
      usage: { agents: [], byRole: [], total: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
        cacheWriteTokens: 0, totalTokens: 0, costUsd: 0, complete: true } }
    }
    await app.evaluate(({ ipcMain, webContents }, value) => {
      ipcMain.removeHandler('orch:snapshot')
      ipcMain.handle('orch:snapshot', () => ({ status: { enabled: true, running: true, error: null }, runs: [value], decisions: [] }))
      for (const contents of webContents.getAllWebContents()) contents.send('orch:changed')
    }, run)
  }
  try {
    await publish('   ')
    await page.locator('#orchestrator-button').click()
    await page.locator('.runs-finished summary').click()
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page.locator('.orch-run-title')).toHaveText('Story preview')
    await expect(page.locator('.orch-story')).toHaveCount(0)
    const text = 'A long story with <untrusted markup> and details. '.repeat(30)
    await publish(text)
    const preview = page.locator('.orch-story-preview')
    await expect(preview).toHaveText(text.trim())
    await expect(preview).toHaveCSS('text-overflow', 'ellipsis')
    await expect(preview).toHaveCSS('white-space', 'nowrap')
    await page.locator('.orch-story summary').click()
    await expect(preview).toBeHidden()
    await expect(page.locator('.orch-story-text')).toHaveText(text.trim())
    await expect(page.locator('.orch-story-text')).toBeVisible()
  } finally { await closeApp(app) }
})
