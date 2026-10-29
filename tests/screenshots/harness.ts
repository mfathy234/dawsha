import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import type { Sandbox } from '../e2e/helpers'
import { APP_VERSION } from '../e2e/helpers'
import { CLAUDE_IDS } from './resumeFixtures'

export const OUT = process.env.DAWSHA_SHOTS_OUT ?? resolve(__dirname, '../../docs/screenshots')
export const DEMO_ROOT = resolve(__dirname, '../../test-results/demo')
export const SCRIPT = resolve(__dirname, 'demo-agent.cjs')
export const SIZE = { width: 1600, height: 1000 }

export const PROJECTS = [
  { id: 'acme-web', name: 'acme-web', defaultAgent: 'claude' },
  { id: 'billing-api', name: 'billing-api', defaultAgent: 'claude' },
  { id: 'mobile-shell', name: 'mobile-shell', defaultAgent: 'codex' },
  { id: 'docs-site', name: 'docs-site', defaultAgent: 'gemini' }
] as const

export const folder = (name: string): string => join(DEMO_ROOT, name)

export function seed(sandbox: Sandbox, withFolders: boolean): void {
  if (withFolders) for (const p of PROJECTS) mkdirSync(folder(p.name), { recursive: true })
  const settings = { version: 2, lastSeenVersion: APP_VERSION, projects: PROJECTS.map((p) => ({ ...p, folder: folder(p.name) })) }
  writeFileSync(join(sandbox.userData, 'settings.json'), JSON.stringify(settings), 'utf8')
}

export function demoEnv(): Record<string, string> {
  const node = process.execPath
  return {
    DAWSHA_CLAUDE_COMMAND: node,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([SCRIPT, 'claude']),
    DAWSHA_CODEX_COMMAND: node,
    DAWSHA_CODEX_ARGS: JSON.stringify([SCRIPT, 'codex']),
    DAWSHA_GEMINI_COMMAND: node,
    DAWSHA_GEMINI_ARGS: JSON.stringify([SCRIPT, 'gemini'])
  }
}

export async function resize(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0]
    let want = [size.width, size.height]
    for (let attempt = 0; attempt < 5; attempt += 1) {
      window.setContentSize(want[0], want[1])
      window.center()
      await new Promise((done) => setTimeout(done, 300))
      const inner = (await window.webContents.executeJavaScript('[innerWidth, innerHeight]')) as [number, number]
      if (inner[0] === size.width && inner[1] === size.height) return
      want = [want[0] + size.width - inner[0], want[1] + size.height - inner[1]]
    }
  }, SIZE)
}

export function writeClaudeSession(sandbox: Sandbox, project: string, name: string, status: string): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${project}.json`),
    JSON.stringify({
      pid: process.pid,
      sessionId: CLAUDE_IDS[project] ?? `sess-${project}`,
      cwd: folder(project),
      name,
      nameSource: 'user',
      status,
      startedAt: now + 1000,
      updatedAt: now + 1000
    }),
    'utf8'
  )
}

export function writeOps(sandbox: Sandbox, failing = false): void {
  const now = Date.now()
  mkdirSync(sandbox.opsDir, { recursive: true })
  const snapshot = {
    v: 1,
    sessionId: CLAUDE_IDS['acme-web'],
    cwd: folder('acme-web'),
    updatedAt: now,
    ended: false,
    model: 'claude-opus-5-5',
    plan: { title: 'Dark mode toggle', done: 3, total: 6 },
    agents: [
      { id: 'a1', description: 'Read the settings components', type: 'worker', model: 'claude-haiku-4-5', status: 'done', startedAt: now - 60_000, finishedAt: now - 46_000, tokens: 12_000, tools: 3 },
      { id: 'a2', description: 'Unit tests for ThemeToggle', type: 'worker', model: 'claude-sonnet-5-5', status: 'running', startedAt: now - 48_000, tokens: 0, tools: 7, lastStep: 'Bash npm test -- ThemeToggle' },
      { id: 'a3', description: 'Persist the choice in localStorage', type: 'worker', model: 'claude-haiku-4-5', status: 'running', startedAt: now - 9000, tools: 2, lastStep: 'Edit src/context/theme.tsx' },
      { id: 'task-4', description: 'Review the diff', status: 'waiting' }
    ],
    advisor: { status: 'done', verdict: 'OK with notes', note: 'check the contrast of the toggle in light mode', description: 'Review plan' },
    context: { percent: 41, tokens: 82_000, window: 200_000, stage: 'fine' },
    compactions: 1,
    cache: { phase: 'warm', leftMs: 2_820_000, hitPercent: 96 },
    limits: [
      { kind: 'five_hour', percentUsed: 62, resetsAt: new Date(now + 100 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(now + 4 * 86_400_000).toISOString() }
    ],
    files: [
      { path: 'src/components/ThemeToggle.tsx', kind: 'A', by: 'claude-sonnet-5-5', at: now },
      { path: 'src/context/theme.tsx', kind: 'M', by: 'claude-sonnet-5-5', at: now },
      { path: 'src/components/Settings.tsx', kind: 'M', by: 'claude-sonnet-5-5', at: now }
    ],
    checks: [
      { kind: 'build', target: 'acme-web', ok: true, summary: 'Build succeeded', at: now - 120_000 },
      { kind: 'test', target: 'acme-web', ok: !failing, summary: failing ? '40 passed  1 failed' : '41 passed  0 failed', at: now - 60_000 }
    ]
  }
  writeFileSync(join(sandbox.opsDir, `${CLAUDE_IDS['acme-web']}.json`), JSON.stringify(snapshot), 'utf8')
}

export function writeCodex(sandbox: Sandbox): void {
  const id = '019aaaaa-0000-7000-8000-00000000d3a0'
  const dir = join(sandbox.codexHome, 'sessions', '2026', '10', '08')
  mkdirSync(dir, { recursive: true })
  const lines = [
    { type: 'session_meta', payload: { id, cwd: folder('mobile-shell'), timestamp: new Date(Date.now() + 1000).toISOString() } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Fix the flaky login test' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Replacing the sleep with a wait on the session ready event.' } },
    { type: 'event_msg', payload: { type: 'task_started' } },
    { type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 64000 }, model_context_window: 200000 } } }
  ]
  writeFileSync(join(dir, `rollout-2026-10-08T12-00-00-${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
  writeFileSync(
    join(sandbox.codexHome, 'session_index.jsonl'),
    JSON.stringify({ id, thread_name: 'Fix flaky login test', updated_at: new Date().toISOString() }) + '\n',
    'utf8'
  )
}

export async function writeGemini(sandbox: Sandbox, page: Page): Promise<void> {
  const settingsPath = join(sandbox.userData, 'settings.json')
  const sessionId = await expect
    .poll(() => {
      const panes = JSON.parse(readFileSync(settingsPath, 'utf8')).workspace?.panes ?? []
      return panes.find((p: { projectId: string }) => p.projectId === 'docs-site')?.tabs?.[0]?.sessionId ?? ''
    })
    .toMatch(/^[0-9a-f-]{36}$/)
    .then(() => {
      const panes = JSON.parse(readFileSync(settingsPath, 'utf8')).workspace.panes
      return panes.find((p: { projectId: string }) => p.projectId === 'docs-site').tabs[0].sessionId as string
    })
  const project = join(sandbox.geminiHome, 'tmp', 'docs-site')
  mkdirSync(join(project, 'chats'), { recursive: true })
  writeFileSync(join(project, '.project_root'), folder('docs-site'), 'utf8')
  const lines = [
    { sessionId, projectHash: 'h', startTime: new Date().toISOString(), lastUpdated: new Date().toISOString(), kind: 'main' },
    { id: 'm1', type: 'user', content: [{ text: 'Rewrite the getting started guide' }] },
    { id: 'm2', type: 'gemini', content: 'Done.', model: 'gemini-2.5-pro' }
  ]
  writeFileSync(
    join(project, 'chats', `session-2026-10-08T12-00-${sessionId.slice(0, 8)}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    'utf8'
  )
  await page.waitForTimeout(0)
}

export async function settle(page: Page, ms = 1500): Promise<void> {
  await page.mouse.move(SIZE.width - 4, SIZE.height - 4)
  await page.waitForTimeout(ms)
}
