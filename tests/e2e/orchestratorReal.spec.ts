import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { APP_VERSION, closeApp, createSandbox, launchApp } from './helpers'

// Uses the real Claude Code CLI and costs a few cents. Run with: ORCH_REAL=1 npx playwright test orchestratorReal
const REAL = process.env.ORCH_REAL === '1'

interface OrchApi {
  orchStartRun(input: unknown): Promise<{ ok: boolean; value?: string; error?: string }>
  orchRuns(): Promise<{ id: string; stage: string }[]>
  orchStatus(): Promise<{ running: boolean }>
}

const orch = <T>(page: Page, fn: (api: OrchApi, arg: unknown) => Promise<T>, arg?: unknown): Promise<T> =>
  page.evaluate(
    ([source, value]) => new Function('api', 'arg', `return (${source})(api, arg)`)((window as unknown as { gridApi: OrchApi }).gridApi, value),
    [fn.toString(), arg] as const
  ) as Promise<T>

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim()

test('real Claude Code fixes a small bug through the orchestrator', async () => {
  test.skip(!REAL, 'Set ORCH_REAL=1 to run against the real Claude Code CLI.')
  test.setTimeout(420_000)
  const sandbox = createSandbox()
  const repo = sandbox.projectFolder
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'greeting.txt'), 'helo world\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify({
    version: 2,
    lastSeenVersion: APP_VERSION,
    onboardingDismissed: true,
    experimental: { orchestrator: true },
    fullAccess: { claude: true, codex: true, gemini: true },
    projects: [{ id: 'smoke', name: 'Smoke', folder: repo }]
  }))
  const env = { ...process.env } as Record<string, string>
  const { app, page } = await launchApp(sandbox, { DAWSHA_CLAUDE_COMMAND: env.DAWSHA_CLAUDE_COMMAND ?? '' })
  try {
    await expect.poll(() => orch(page, (api) => api.orchStatus()).then((s) => s.running), { timeout: 15_000 }).toBe(true)
    const started = await orch(page, (api, input) => api.orchStartRun(input), {
      kind: 'bug',
      projectId: 'smoke',
      title: 'Typo in greeting.txt',
      story: 'greeting.txt says "helo world"; it must say "hello world". Fix the typo, commit it on your branch, and complete the task.',
      planId: 'default',
      fixerProfileId: 'p-tester'
    })
    expect(started).toMatchObject({ ok: true })
    await expect.poll(async () => (await orch(page, (api) => api.orchRuns()))[0]?.stage, { timeout: 360_000, intervals: [5_000] }).toBe('merge')
    const short = String(started.value).replace(/^run_/, '').slice(0, 8)
    expect(git(repo, 'show', `orch/${short}/run:greeting.txt`)).toBe('hello world')
  } finally {
    await closeApp(app)
  }
})
