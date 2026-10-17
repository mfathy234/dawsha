import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp } from './helpers'

const FAKE_ORCH = resolve(__dirname, '../support/fakeOrchAgent.cjs')

interface OrchApi {
  orchStartRun(input: unknown): Promise<{ ok: boolean; value?: string; error?: string }>
  orchRuns(): Promise<{ id: string; stage: string; tasks: number; tasksDone: number }[]>
  orchDecisions(): Promise<{ id: string; kind: string; question: string }[]>
  orchAnswer(id: string, answer: string): Promise<{ ok: boolean }>
  orchStatus(): Promise<{ enabled: boolean; running: boolean; error: string | null }>
}

const orch = <T>(page: Page, fn: (api: OrchApi, arg: unknown) => Promise<T>, arg?: unknown): Promise<T> =>
  page.evaluate(
    ([source, value]) => new Function('api', 'arg', `return (${source})(api, arg)`)((window as unknown as { gridApi: OrchApi }).gridApi, value),
    [fn.toString(), arg] as const
  ) as Promise<T>

function git(cwd: string, ...args: string[]): string {
  const identity = ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid']
  return execFileSync('git', [...identity, ...args], { cwd, encoding: 'utf8' }).trim()
}

test('a bug run opens one fixer pane in its own worktree, merges its work and finishes', async () => {
  test.setTimeout(120_000)
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
    await expect.poll(() => orch(page, (api) => api.orchStatus()).then((s) => s.running), { timeout: 15_000 }).toBe(true)
    const started = await orch(page, (api, input) => api.orchStartRun(input), {
      kind: 'bug', projectId: 'smoke', title: 'Export crashes on an empty range', story: 'Clicking Export with no data throws.', planId: 'default', fixerProfileId: null
    })
    expect(started.ok).toBe(true)

    // The fixer appears as a normal pane titled with its role and model.
    await expect(page.locator('.pane')).toHaveCount(1, { timeout: 20_000 })
    await expect(page.locator('.pane').first()).toContainText('Fixer')

    // The fake agent completes its task; Dawsha merges the task branch into the run branch.
    await expect.poll(async () => (await orch(page, (api) => api.orchRuns()))[0]?.stage, { timeout: 60_000 }).toBe('merge')
    const short = String(started.value).replace(/^run_/, '').slice(0, 8)
    expect(git(repo, 'log', '--oneline', `orch/${short}/run`)).toContain('fix: Export crashes on an empty range')
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(existsSync(join(repo, 'fix.txt'))).toBe(false)

    // The human marks the run done.
    const decisions = await orch(page, (api) => api.orchDecisions())
    const complete = decisions.find((d) => d.kind === 'run-complete')
    expect(complete?.question).toContain(`orch/${short}/run`)
    await orch(page, (api, id) => api.orchAnswer(String(id), 'Mark as done'), complete?.id)
    await expect.poll(async () => (await orch(page, (api) => api.orchRuns()))[0]?.stage, { timeout: 15_000 }).toBe('done')
  } finally {
    await closeApp(app)
  }
  const quitLog = existsSync(sandbox.quitLog) ? readFileSync(sandbox.quitLog, 'utf8') : ''
  expect(quitLog).not.toContain('orchestrator did not start')
})
