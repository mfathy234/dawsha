import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp, type Sandbox } from './helpers'

// Real Claude Code (and Codex) agents on paths the feature test does not cover; costs real tokens. Run with:
//   ORCH_REAL=1 npx playwright test orchestratorRealPaths -g "<name>"
// Each scenario drives a run to its finish question, answering like the user would (approving a spec), and checks
// the outcome on the run branch.
const REAL = process.env.ORCH_REAL === '1'
const SHOTS = process.env.ORCH_REAL_SHOTS ?? 'test-results/real-paths'

interface Snapshot {
  runs: { id: string; kind: string; stage: string; title: string; tasks: { key: string; role: string; status: string; review?: boolean }[]; agents: { role: string; model: string; runner: string }[] }[]
  decisions: { id: string; question: string; kind: string; options: string[] }[]
}

const api = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([name, values]) => (window as unknown as { gridApi: Record<string, (...a: unknown[]) => Promise<unknown>> }).gridApi[name as string](...(values as unknown[])), [fn, args] as const) as Promise<T>

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

/** A small two-package repo: web/ and api/, each with a module and a test. */
function seedRepo(repo: string): void {
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.invalid')
  for (const dir of ['web', 'api']) mkdirSync(join(repo, dir))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { test: 'node api/test.js && node web/test.js' } }, null, 2))
  writeFileSync(join(repo, 'api', 'prices.js'), 'function total(items) {\n  return items.reduce((sum, i) => sum + i.price, 0)\n}\n\nmodule.exports = { total }\n')
  writeFileSync(join(repo, 'api', 'test.js'), "const assert = require('node:assert')\nconst { total } = require('./prices')\nassert.strictEqual(total([{ price: 2 }, { price: 3 }]), 5)\nconsole.log('api ok')\n")
  writeFileSync(join(repo, 'web', 'label.js'), "function label(name) {\n  return name\n}\n\nmodule.exports = { label }\n")
  writeFileSync(join(repo, 'web', 'test.js'), "const assert = require('node:assert')\nconst { label } = require('./label')\nassert.strictEqual(label('Tea'), 'Tea')\nconsole.log('web ok')\n")
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
}

function settingsFor(sandbox: Sandbox, orchestrator?: unknown): void {
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    version: 2, lastSeenVersion: APP_VERSION, onboardingDismissed: true,
    experimental: { orchestrator: true },
    fullAccess: { claude: true, codex: true, gemini: true },
    recordings: { enabled: true, keepDays: 14, maxMegabytes: 200 },
    projects: [{ id: 'shop', name: 'Shop', folder: sandbox.projectFolder }],
    ...(orchestrator ? { orchestrator } : {})
  }))
}

/** Waits for the run's finish question, approving any spec on the way; fails on any other question. */
async function driveToFinish(page: Page, label: string, minutes: number): Promise<Snapshot['runs'][number]> {
  mkdirSync(SHOTS, { recursive: true })
  const started = Date.now()
  let last = ''
  while (Date.now() - started < minutes * 60_000) {
    const state = await api<Snapshot>(page, 'orchSnapshot')
    const run = state.runs[0]
    for (const decision of state.decisions) {
      if (decision.kind === 'spec-approval') {
        console.log(`[${label}] approving the spec`)
        await api(page, 'orchAnswer', decision.id, 'Approve')
      } else if (decision.kind !== 'run-complete') {
        await page.screenshot({ path: join(SHOTS, `${label}-question.png`) })
        throw new Error(`[${label}] an agent asked the human: ${decision.question}`)
      }
    }
    const now = run ? `${run.stage} ${run.tasks.map((t) => `${t.key}:${t.role}:${t.status}`).join(',')} | ${run.agents.map((a) => `${a.role}/${a.runner}/${a.model}`).join(',')}` : 'none'
    if (now !== last) {
      last = now
      console.log(`[${label} ${Math.round((Date.now() - started) / 1000)}s] ${now}`)
    }
    if (run?.stage === 'merge') {
      if (!(await page.locator('.orch-view').isVisible())) await page.locator('#orchestrator-button').click()
      await page.waitForTimeout(400)
      await page.screenshot({ path: join(SHOTS, `${label}-finished.png`) })
      return run
    }
    await page.waitForTimeout(5_000)
  }
  throw new Error(`[${label}] the run did not finish in ${minutes} minutes; last state: ${last}`)
}

async function startFeature(page: Page, story: string): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.locator('#orchestrator-button').click()
  await page.locator('#orch-tab-new').click()
  await page.locator('#orch-nr-story').fill(story)
  await page.locator('#orch-nr-start').click()
}

const runBranchOf = (run: { id: string }): string => `orch/${run.id.replace(/^run_/, '').slice(0, 8)}/run`

test.describe('real orchestrator paths', () => {
  test.skip(!REAL, 'Set ORCH_REAL=1 to run against the real CLIs.')
  test.setTimeout(1_500_000)

  test('team: a large change split across two packages, each reviewed', async () => {
    const sandbox = createSandbox()
    seedRepo(sandbox.projectFolder)
    settingsFor(sandbox)
    const { app, page } = await launchApp(sandbox, { DAWSHA_CLAUDE_COMMAND: '', DAWSHA_CODEX_COMMAND: '' })
    try {
      await startFeature(page, 'This is large work in two separate packages that should be done in parallel by two implementers, each change reviewed: ' +
        '(1) in api/prices.js add a discount(items, percent) function that returns the total minus percent, rounded to 2 decimals, with tests in api/test.js; ' +
        '(2) in web/label.js make label(name, price) return "Tea · $2.00" (two decimals), with tests in web/test.js.')
      const run = await driveToFinish(page, 'team', 22)
      const implementers = run.tasks.filter((t) => t.role === 'implementer')
      expect(implementers.length).toBeGreaterThanOrEqual(2)
      expect(run.tasks.filter((t) => t.role === 'code-reviewer').length).toBeGreaterThanOrEqual(1)
      const branch = runBranchOf(run)
      expect(git(sandbox.projectFolder, 'show', `${branch}:api/prices.js`)).toMatch(/discount/)
      expect(git(sandbox.projectFolder, 'show', `${branch}:web/label.js`)).toMatch(/toFixed\(2\)|Intl/)
    } finally {
      await closeApp(app)
    }
  })

  test('spec: an unclear request gets a spec, which the human approves, then it is built', async () => {
    const sandbox = createSandbox()
    seedRepo(sandbox.projectFolder)
    settingsFor(sandbox)
    const { app, page } = await launchApp(sandbox, { DAWSHA_CLAUDE_COMMAND: '', DAWSHA_CODEX_COMMAND: '' })
    try {
      await startFeature(page, 'We need a new receipt screen for the web package, but the layout and wording are not decided yet: ' +
        'write a spec with a mockup first and ask me to approve it before building. Then build it as web/receipt.js exporting receipt(items) that returns the text of the receipt, with a test.')
      const run = await driveToFinish(page, 'spec', 25)
      expect(run.tasks.some((t) => t.role === 'spec-writer' && t.status === 'approved')).toBe(true)
      expect(git(sandbox.projectFolder, 'ls-tree', '-r', '--name-only', runBranchOf(run))).toMatch(/web\/receipt\.js/)
    } finally {
      await closeApp(app)
    }
  })

  test('bug: one Claude fixer fixes a reported bug alone', async () => {
    const sandbox = createSandbox()
    seedRepo(sandbox.projectFolder)
    writeFileSync(join(sandbox.projectFolder, 'api', 'prices.js'), 'function total(items) {\n  return items.reduce((sum, i) => sum + i.price, 1)\n}\n\nmodule.exports = { total }\n')
    git(sandbox.projectFolder, 'commit', '-qam', 'refactor totals')
    settingsFor(sandbox)
    const { app, page } = await launchApp(sandbox, { DAWSHA_CLAUDE_COMMAND: '', DAWSHA_CODEX_COMMAND: '' })
    try {
      await page.setViewportSize({ width: 1600, height: 1000 })
      await page.locator('#orchestrator-button').click()
      await page.locator('#orch-tab-new').click()
      await page.locator('#orch-nr-kind').getByText('Bug', { exact: true }).click()
      await page.locator('#orch-nr-fixer-claude').click()
      await page.locator('#orch-nr-story').fill('npm test fails: total([{price:2},{price:3}]) returns 6 instead of 5 in api/prices.js. Fix it with a regression test.')
      await page.locator('#orch-nr-start').click()
      const run = await driveToFinish(page, 'bug', 15)
      expect(run.kind).toBe('bug')
      expect(run.agents).toHaveLength(1)
      expect(git(sandbox.projectFolder, 'show', `${runBranchOf(run)}:api/prices.js`)).toMatch(/,\s*0\s*\)/)
    } finally {
      await closeApp(app)
    }
  })

  test('codex: the lead hands a task to a Codex implementer that finishes it', async () => {
    const sandbox = createSandbox()
    seedRepo(sandbox.projectFolder)
    // The default plan with Codex as the implementer.
    const { defaultOrchSettings } = await import('../../src/shared/orch/profiles')
    const orchestrator = defaultOrchSettings()
    orchestrator.plans[0] = { ...orchestrator.plans[0], roles: { ...orchestrator.plans[0].roles, implementer: 'p-implementer-codex' } }
    settingsFor(sandbox, orchestrator)
    const { app, page } = await launchApp(sandbox, { DAWSHA_CLAUDE_COMMAND: '', DAWSHA_CODEX_COMMAND: '' })
    try {
      await startFeature(page, 'Do not do this yourself: give it to one implementer. In web/label.js make label(name) return the name in upper case, and update web/test.js.')
      const run = await driveToFinish(page, 'codex', 20)
      expect(run.agents.some((a) => a.role === 'implementer' && a.runner === 'codex')).toBe(true)
      expect(run.tasks.some((t) => t.role === 'implementer' && t.status === 'approved')).toBe(true)
      expect(git(sandbox.projectFolder, 'show', `${runBranchOf(run)}:web/label.js`)).toMatch(/toUpperCase/)
    } finally {
      await closeApp(app)
    }
  })
})
