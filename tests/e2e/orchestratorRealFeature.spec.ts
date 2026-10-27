import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp, openMore } from './helpers'

// Real Claude Code CLIs on the default plan; costs real tokens. Run with:
//   ORCH_REAL=1 npx playwright test orchestratorRealFeature
// Uses the machine's own CLI config (hooks included), like a user's run.
const REAL = process.env.ORCH_REAL === '1'
const SHOTS = process.env.ORCH_REAL_SHOTS ?? 'test-results/real-feature'

interface Snapshot {
  runs: { id: string; stage: string; title: string; tasks: { key: string; role: string; status: string }[]; agents: { role: string; model: string }[]; events: { text: string }[] }[]
  decisions: { question: string; kind: string }[]
}

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => (window as unknown as { gridApi: { orchSnapshot(): Promise<Snapshot> } }).gridApi.orchSnapshot())

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

// Long on purpose: the title is cut from the start, and the detail the lead needs is only at the end.
const STORY = 'on a branch based on main in this small repo the price helper needs a change because the finance team asked for it, ' +
  'and the change is this: formatPrice in src/price.js must format with exactly two decimals and a leading dollar sign, ' +
  'so formatPrice(5) returns "$5.00" and formatPrice(3.456) returns "$3.46". Update the existing test in test/price.test.js to cover both cases.'

test('real feature run: the lead reads the full story and uses a small team', async () => {
  test.skip(!REAL, 'Set ORCH_REAL=1 to run against the real CLIs.')
  test.setTimeout(1_200_000)
  mkdirSync(SHOTS, { recursive: true })
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  git(repo, 'init', '-q', '-b', 'main')
  mkdirSync(join(repo, 'src'))
  mkdirSync(join(repo, 'test'))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'price', version: '1.0.0', scripts: { test: 'node test/price.test.js' } }, null, 2))
  writeFileSync(join(repo, 'src', 'price.js'), 'function formatPrice(value) {\n  return String(value)\n}\n\nmodule.exports = { formatPrice }\n')
  writeFileSync(join(repo, 'test', 'price.test.js'), "const assert = require('node:assert')\nconst { formatPrice } = require('../src/price')\n\nassert.strictEqual(typeof formatPrice(1), 'string')\nconsole.log('ok')\n")
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true,
    experimental: { orchestrator: true },
    fullAccess: { claude: true, codex: true, gemini: true },
    // Recorded panes show what each agent's terminal displayed if the run fails.
    recordings: { enabled: true, keepDays: 14, maxMegabytes: 200 },
    projects: [{ id: 'price', name: 'Price', folder: repo }]
  }))
  const { app, page } = await launchApp(sandbox, { DAWSHA_CLAUDE_COMMAND: '', DAWSHA_CODEX_COMMAND: '' })
  let shot = 0
  const capture = async (name: string): Promise<void> => {
    shot += 1
    // Let the tab's short fade-in finish, so the shot shows what a person sees.
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(SHOTS, `${String(shot).padStart(2, '0')}-${name}.png`) }).catch(() => undefined)
  }
  try {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await openMore(page, 'orchestrator')
    await page.locator('#orch-tab-new').click()
    await page.locator('#orch-nr-story').fill(STORY)
    await capture('new-run')
    await page.locator('#orch-nr-start').click()

    const started = Date.now()
    let last = ''
    let finalState: Snapshot | null = null
    while (Date.now() - started < 1_100_000) {
      const state = await snapshot(page)
      const run = state.runs[0]
      if (state.decisions.some((d) => d.kind !== 'run-complete')) {
        await capture('question')
        throw new Error(`An agent asked the human: ${state.decisions.map((d) => d.question).join(' | ')}`)
      }
      const now = run ? `${run.stage} ${run.tasks.map((t) => `${t.key}:${t.role}:${t.status}`).join(',')}` : 'none'
      if (now !== last) {
        last = now
        console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${now} | agents ${run?.agents.map((a) => `${a.role}/${a.model}`).join(',')}`)
        if (!(await page.locator('.orch-view').isVisible())) await openMore(page, 'orchestrator')
        await capture(run?.stage ?? 'none')
      }
      if (run?.stage === 'merge') { finalState = state; break }
      await page.waitForTimeout(5_000)
    }
    console.log(`sandbox: ${sandbox.root}`)
    expect(finalState, `the run did not reach merge; last state: ${last}`).not.toBeNull()
    const run = finalState!.runs[0]
    expect(run.title.endsWith('…')).toBe(true)
    // A small, clear change: the lead sizes it and does it itself. One agent, no reviewer.
    expect(run.agents).toHaveLength(1)
    expect(run.tasks.map((t) => t.role)).toEqual(['lead'])
    const short = run.id.replace(/^run_/, '').slice(0, 8)
    const source = git(repo, 'show', `orch/${short}/run:src/price.js`)
    expect(source).toMatch(/toFixed\(2\)|Intl\.NumberFormat/)
    // Every screen shows the run, as the user sees it.
    const view = page.locator('.orch-view')
    await page.locator('#orch-tab-runs').click()
    await expect(view).toContainText('Run finished')
    await capture('all-runs')
    await page.locator('#orch-tab-boards').click()
    await expect(page.locator('.orch-projtab').first()).toBeVisible()
    await capture('boards')
    await page.locator('#orch-tab-review').click()
    await expect(view).toContainText('is finished on branch orch/')
    await capture('review')
    // Finish like the user would: Mark as done. The run ends and its agents' panes close, without error toasts.
    await page.getByRole('button', { name: 'Send' }).click()
    await expect.poll(async () => (await snapshot(page)).runs[0].stage, { timeout: 30_000 }).toBe('done')
    await expect(page.locator('.pane')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.locator('.toast.error')).toHaveCount(0)
    await page.locator('#orch-tab-history').click()
    await expect(view).toContainText('done')
    await capture('history')
  } finally {
    await closeApp(app)
  }
})
