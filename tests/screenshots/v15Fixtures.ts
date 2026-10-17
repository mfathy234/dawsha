import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Sandbox } from '../e2e/helpers'
import type { OrchAgentRow, OrchDecisionView, OrchRunDetail } from '../../src/shared/orch/api'
import type { AgentCost, RunUsage } from '../../src/shared/orch/usage'
import type { OrchEvent, OrchRole, OrchTask, TaskStatus } from '../../src/shared/orch/types'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const task = (runId: string, n: number, title: string, role: OrchRole, status: TaskStatus, extra: Partial<OrchTask> = {}): OrchTask => ({
  id: `${runId}:T-${n}`, key: `T-${n}`, runId, title, spec: '', role, status, dependsOn: [], acceptance: [], reviewOf: null, reviewRound: 0,
  assignee: null, summary: null, files: [], branch: null, feedback: null, pausedFrom: null, createdAt: Date.now() - 50 * MINUTE, updatedAt: Date.now() - 5 * MINUTE, ...extra
})

const cost = (agentId: string, role: OrchRole, runner: string, model: string, input: number, output: number, cache: number, usd: number | null): AgentCost => ({
  agentId, role, runner, model, inputTokens: input, outputTokens: output, cacheReadTokens: cache, cacheWriteTokens: 0, totalTokens: input + output + cache,
  costUsd: usd, costSource: usd === null ? 'unpriced' : runner === 'claude' ? 'reported' : 'estimated'
})

const usageOf = (agents: AgentCost[]): RunUsage => {
  const roles = [...new Set(agents.map((a) => a.role))]
  const sum = (key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'totalTokens'): number => agents.reduce((s, a) => s + a[key], 0)
  return {
    agents,
    byRole: roles.map((role) => {
      const own = agents.filter((a) => a.role === role)
      return { role, agents: own.length, totalTokens: own.reduce((s, a) => s + a.totalTokens, 0), costUsd: own.reduce((s, a) => s + (a.costUsd ?? 0), 0) }
    }),
    total: { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadTokens: sum('cacheReadTokens'), cacheWriteTokens: sum('cacheWriteTokens'), totalTokens: sum('totalTokens'), costUsd: agents.reduce((s, a) => s + (a.costUsd ?? 0), 0), complete: true }
  }
}

const event = (runId: string, minutesAgo: number, text: string, taskKey: string | null = null): OrchEvent => ({
  runId, at: Date.now() - minutesAgo * MINUTE, kind: 'info', text, taskId: taskKey ? `${runId}:${taskKey}` : null
})

const agentRow = (id: string, role: OrchRole, runner: string, model: string, state: OrchAgentRow['state'], taskKey: string | null, retired = false): OrchAgentRow =>
  ({ id, role, runner, model, state, taskKey, retired })

export function exportRun(): OrchRunDetail {
  const id = 'run_exportcsv'
  const tasks = [
    task(id, 1, 'Write the spec for CSV export', 'spec-writer', 'approved', { assignee: 'a2', summary: 'Spec approved' }),
    task(id, 2, 'Export service and CSV format', 'implementer', 'in_progress', { assignee: 'a3', review: true, dependsOn: ['T-1'] }),
    task(id, 3, 'Export button and dialog', 'ui', 'in_progress', { assignee: 'a4', dependsOn: ['T-1'] }),
    task(id, 4, 'Handle an empty date range', 'implementer', 'waiting_on_human', { dependsOn: ['T-2'] }),
    task(id, 5, 'Review the export service', 'code-reviewer', 'todo', { reviewOf: 'T-2', dependsOn: ['T-2'] }),
    task(id, 6, 'Tests for the export', 'tester', 'todo', { dependsOn: ['T-2', 'T-3'] })
  ]
  const agents = [
    agentRow('a1', 'lead', 'claude', 'claude-opus-5-5', 'idle', null),
    agentRow('a2', 'spec-writer', 'claude', 'claude-sonnet-5-5', 'done', 'T-1', true),
    agentRow('a3', 'implementer', 'claude', 'claude-sonnet-5-5', 'working', 'T-2'),
    agentRow('a4', 'ui', 'codex', 'gpt-5.6-sol', 'working', 'T-3')
  ]
  return {
    id, kind: 'feature', stage: 'build', title: 'Add CSV export to the usage report', projectId: 'acme-web', createdAt: Date.now() - 52 * MINUTE,
    taskCount: tasks.length, tasksDone: 1, openDecisions: 1, story: 'Let people export the usage report for a date range as a CSV file, from a button on the report page.',
    plan: 'default', projectPath: 'C:\\dawsha-demo\\acme-web', finishedAt: null, branch: 'orch/exportcs/run', tasks, agents,
    estimate: { size: 'large', reason: 'a new service, a dialog and tests across two packages' },
    usage: usageOf([
      cost('a1', 'lead', 'claude', 'claude-opus-5-5', 41_000, 9_200, 310_000, 1.86),
      cost('a2', 'spec-writer', 'claude', 'claude-sonnet-5-5', 18_000, 6_400, 120_000, 0.42),
      cost('a3', 'implementer', 'claude', 'claude-sonnet-5-5', 62_000, 18_500, 540_000, 1.31),
      cost('a4', 'ui', 'codex', 'gpt-5.6-sol', 38_000, 12_100, 260_000, 0.74)
    ]),
    events: [
      event(id, 51, 'Run started. The lead is sizing the work.'),
      event(id, 49, 'The lead sized this as large and chose a team.'),
      event(id, 47, 'Spec writer started on the spec.', 'T-1'),
      event(id, 38, 'Spec approved.', 'T-1'),
      event(id, 36, 'Implementer started in its own worktree.', 'T-2'),
      event(id, 36, 'UI agent (Codex) started in its own worktree.', 'T-3'),
      event(id, 14, 'Waiting for your answer: include archived projects?', 'T-4'),
      event(id, 6, 'Implementer committed: add the CSV writer.', 'T-2')
    ]
  }
}

export function invoiceBugRun(): OrchRunDetail {
  const id = 'run_invoicebg'
  const tasks = [task(id, 1, 'Fix the crash when the invoice list is empty', 'fixer', 'in_review', { assignee: 'b2', review: true, summary: 'Guarded the empty list' })]
  return {
    id, kind: 'bug', stage: 'build', title: 'Crash when the invoice list is empty', projectId: 'billing-api', createdAt: Date.now() - 19 * MINUTE,
    taskCount: 1, tasksDone: 0, openDecisions: 0, story: 'Opening Invoices for a new account throws a null reference.', plan: 'default', projectPath: 'C:\\dawsha-demo\\billing-api',
    finishedAt: null, branch: 'orch/invoice/run', tasks, agents: [agentRow('b2', 'fixer', 'codex', 'gpt-5.6-sol', 'working', 'T-1')],
    usage: usageOf([cost('b2', 'fixer', 'codex', 'gpt-5.6-sol', 22_000, 5_100, 90_000, 0.28)]), events: [event(id, 18, 'Fixer started in its own worktree.', 'T-1')]
  }
}

export function offlineRun(): OrchRunDetail {
  const id = 'run_offlinebn'
  const tasks = [
    task(id, 1, 'Detect the connection state', 'implementer', 'approved'),
    task(id, 2, 'Offline banner component', 'ui', 'in_progress', { assignee: 'c3' }),
    task(id, 3, 'Queue edits while offline', 'implementer', 'todo', { dependsOn: ['T-1'] }),
    task(id, 4, 'Review the banner', 'code-reviewer', 'done_pending_review', { reviewOf: 'T-2' })
  ]
  return {
    id, kind: 'feature', stage: 'build', title: 'Show an offline banner in the app', projectId: 'mobile-shell', createdAt: Date.now() - 95 * MINUTE,
    taskCount: tasks.length, tasksDone: 1, openDecisions: 0, story: 'Show a banner while the device is offline and queue edits until it reconnects.', plan: 'default',
    projectPath: 'C:\\dawsha-demo\\mobile-shell', finishedAt: null, branch: 'orch/offline/run', tasks,
    agents: [agentRow('c1', 'lead', 'codex', 'gpt-5.6-sol', 'idle', null), agentRow('c3', 'ui', 'claude', 'claude-sonnet-5-5', 'working', 'T-2')],
    estimate: { size: 'medium', reason: 'one component and a small queue' },
    usage: usageOf([cost('c1', 'lead', 'codex', 'gpt-5.6-sol', 30_000, 7_000, 150_000, 0.51), cost('c3', 'ui', 'claude', 'claude-sonnet-5-5', 24_000, 8_000, 180_000, 0.47)]), events: [event('run_offlinebn', 90, 'Run started.')]
  }
}

export const exportDecision = (): OrchDecisionView => ({
  id: 'd1', kind: 'question', runId: 'run_exportcsv', runTitle: 'Add CSV export to the usage report',
  question: 'Should the export include archived projects, or only active ones?', options: ['Active projects only', 'Include archived projects'],
  context: 'The usage report hides archived projects by default.', createdAt: Date.now() - 14 * MINUTE, taskKey: 'T-4', agentRole: 'implementer', agentModel: 'claude-sonnet-5-5'
})

interface DemoWork { project: string; daysAgo: number; hour: number; minutes: number; title: string; branch: string; agent: 'claude' | 'codex'; commits: string[] }

const DEMO_WORK: DemoWork[] = [
  { project: 'acme-web', daysAgo: 2, hour: 9, minutes: 52, title: 'Add dark mode toggle', branch: 'feature/4210-dark-mode', agent: 'claude', commits: ['feat: add a dark mode toggle'] },
  { project: 'acme-web', daysAgo: 1, hour: 15, minutes: 38, title: 'Persist the theme choice', branch: 'feature/4210-dark-mode', agent: 'claude', commits: ['feat: remember the theme'] },
  { project: 'billing-api', daysAgo: 1, hour: 11, minutes: 44, title: 'Fix invoice total rounding', branch: 'fix/4188-rounding', agent: 'claude', commits: ['fix: round invoice totals half up'] },
  { project: 'mobile-shell', daysAgo: 4, hour: 11, minutes: 30, title: 'Fix flaky login test', branch: 'fix/4195-login-test', agent: 'codex', commits: ['fix: wait for the session ready event'] },
  { project: 'billing-api', daysAgo: 3, hour: 14, minutes: 24, title: 'Explain the export format', branch: 'main', agent: 'claude', commits: [] },
  { project: 'acme-web', daysAgo: 3, hour: 9, minutes: 46, title: 'Update the README', branch: 'main', agent: 'claude', commits: ['docs: describe the theme setting'] },
  { project: 'docs-site', daysAgo: 2, hour: 13, minutes: 28, title: 'Rewrite the getting started guide', branch: 'main', agent: 'claude', commits: ['docs: rewrite getting started'] },
  { project: 'mobile-shell', daysAgo: 4, hour: 15, minutes: 56, title: 'Offline banner', branch: 'feature/4203-offline-banner', agent: 'codex', commits: ['feat: show an offline banner'] },
  { project: 'billing-api', daysAgo: 5, hour: 16, minutes: 33, title: 'Compare invoice libraries', branch: 'main', agent: 'claude', commits: [] }
]

const sessionId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export function demoTicketNotes(): Record<string, { name: string; link: string }> {
  return {
    'branch:acme-web:feature/4210-dark-mode': { name: 'Dark mode for the settings page', link: 'https://tracker.example.com/ACME-4210' },
    'branch:billing-api:fix/4188-rounding': { name: 'Invoice totals off by one cent', link: 'https://tracker.example.com/BILL-4188' }
  }
}

export function writeWorkHistory(sandbox: Sandbox, folder: (name: string) => string): void {
  const git = (cwd: string, date: Date, ...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=Demo User', '-c', 'user.email=demo@example.invalid', ...args], {
      cwd, windowsHide: true, env: { ...process.env, GIT_AUTHOR_DATE: date.toISOString(), GIT_COMMITTER_DATE: date.toISOString() }
    })
  }
  const repos = new Set<string>()
  let n = 100
  for (const work of DEMO_WORK) {
    n++
    const cwd = folder(work.project)
    if (!repos.has(cwd)) {
      mkdirSync(cwd, { recursive: true })
      git(cwd, new Date(Date.now() - 30 * DAY), 'init', '-q', '-b', 'main')
      git(cwd, new Date(Date.now() - 30 * DAY), 'config', 'user.email', 'demo@example.invalid')
      repos.add(cwd)
    }
    const start = new Date(Date.now() - work.daysAgo * DAY)
    start.setHours(work.hour, 0, 0, 0)
    const stamps: string[] = []
    for (let at = 0; at <= work.minutes; at += 4) stamps.push(new Date(start.getTime() + at * MINUTE).toISOString())
    const last = new Date(start.getTime() + work.minutes * MINUTE).toISOString()
    if (!stamps.includes(last)) stamps.push(last)
    const id = sessionId(n)
    if (work.agent === 'codex') {
      const codexDir = join(sandbox.codexHome, 'sessions', String(start.getFullYear()), String(start.getMonth() + 1).padStart(2, '0'), String(start.getDate()).padStart(2, '0'))
      mkdirSync(codexDir, { recursive: true })
      const rows = [{ type: 'session_meta', payload: { id, cwd, timestamp: stamps[0], git: { branch: work.branch } } },
        ...stamps.slice(1).map((timestamp, i) => ({ type: 'event_msg', timestamp, payload: i === 0 ? { type: 'user_message', message: work.title } : { type: 'agent_message', message: 'Working on it.' } }))]
      writeFileSync(join(codexDir, `rollout-${start.toISOString().slice(0, 19).replace(/:/g, '-')}-${id}.jsonl`), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8')
    } else {
      const dir = join(sandbox.claudeHome, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
      mkdirSync(dir, { recursive: true })
      const rows = [...stamps.map((timestamp, i) => i === 0
        ? { type: 'user', timestamp, gitBranch: work.branch, cwd, message: { content: work.title } }
        : { type: 'assistant', timestamp, gitBranch: work.branch, cwd, message: { content: [{ type: 'text', text: 'Working on it.' }] } }),
      { type: 'ai-title', aiTitle: work.title }]
      writeFileSync(join(dir, `${id}.jsonl`), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8')
    }
    work.commits.forEach((subject, i) => {
      git(cwd, new Date(start.getTime() + (work.minutes - 2 - i) * MINUTE), 'commit', '--allow-empty', '-qm', subject)
    })
  }
}
