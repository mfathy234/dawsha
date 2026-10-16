# Orchestrator Phase 1: Core Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A working, fully tested orchestration core in Electron's main process: the task state machine,
role permissions, a SQLite store, the orch service (every MCP tool), and a local MCP server that real CLI
agents can connect to. No UI and no panes yet.

**Architecture:** Pure logic in `src/shared/orch/` (types, task state machine, roles, tool schemas).
I/O in `src/main/orch/`: `store.ts` (node:sqlite, one JSON `data` column per row plus indexed columns),
`service.ts` (tool behaviour, host API for the UI), `mcpServer.ts` (MCP Streamable HTTP, JSON responses
only, bearer token per agent, localhost only). Started from `src/main/index.ts` only when the
experimental setting is on.

**Tech Stack:** TypeScript, Node 24 `node:sqlite` (`DatabaseSync`), `node:http`, vitest. No new dependencies.

Design: `docs/plans/2026-10-16-orchestrator-design.md`. Mockups: https://claude.ai/artifact/ADwGF2HY7VkJXfMKyAqVJU

---

## Roadmap (this plan is phase 1 only)

| Phase | Delivers |
|---|---|
| **1 Core** (this plan) | State machine, roles, store, service, MCP server, experimental switch |
| 2 Runners + dispatcher | Profiles/plans in settings (with effort), runner adapters (Claude, Codex, Gemini, OpenCode), panes per task in worktrees, verified-submit nudges, stall detection, profile check |
| 3 Orchestrator UI | All runs, project boards with filters and project chips, run dashboard, Human review, Settings → Orchestrator |
| 4 Spec writer | Spec + HTML mockups, Spec review with comments and versions |
| 5 History | History tab, `.dawsharun` export/import, Markdown report |

## Behaviour this phase must implement

- **Statuses:** `todo, assigned, in_progress, done_pending_review, in_review, approved, blocked,
  waiting_on_human, stalled, cancelled`. `approved` and `cancelled` are final.
- **Pausing:** `blocked` and `waiting_on_human` can be entered from any non-final status and remember
  `pausedFrom`; resuming returns to it.
- **Claiming:** `get_my_task` returns the agent's current task, else claims the oldest `todo` task in its
  run for its role whose dependencies are all `approved`.
- **Completing** (`complete_task`):
  - implementer / ui → `done_pending_review` and a new review task (role `code-reviewer`, `reviewOf` set).
  - spec-writer → `done_pending_review` and a `spec-approval` decision for the human.
  - tester and anything else → `approved`.
- **Reviewing:** when a reviewer claims a review task the original goes to `in_review`.
  `submit_review('approve')` approves both. `'reject'` increments `reviewRound`, returns the original to
  `in_progress` and messages its assignee the comments; at round 2 (max) the original instead goes to
  `waiting_on_human` with an `escalation` decision.
- **Human:** `ask_human` creates a `question` decision and pauses the caller's task. `answerDecision`
  stores the answer as a note `decision:<id>`, resumes the task, messages the agent. Spec approval:
  answer `Approve` → `approved`, anything else → back to `in_progress` with the answer as feedback.
- **Permissions:** each role sees and may call only its tools (`ROLE_TOOLS`); others return a tool error.
- **Events:** every state change writes a timeline event.
- **MCP server:** `POST /mcp` JSON-RPC (`initialize`, `ping`, `tools/list`, `tools/call`, notifications →
  202). `Authorization: Bearer <agent token>` required (401). Requests with a non-localhost `Origin` → 403.
  Body limit 1 MB (413). Binds `127.0.0.1` on a random port.

---

### Task 1: Shared types and the task state machine

**Files:**
- Create: `src/shared/orch/types.ts`, `src/shared/orch/taskMachine.ts`
- Test: `tests/unit/orchTaskMachine.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { canMove, isFinal, moveTask, pauseTask, resumeTask } from '../../src/shared/orch/taskMachine'
import type { OrchTask } from '../../src/shared/orch/types'

const task = (over: Partial<OrchTask> = {}): OrchTask => ({
  id: 'r1:T-1', key: 'T-1', runId: 'r1', title: 'x', spec: '', role: 'implementer', status: 'todo',
  dependsOn: [], acceptance: [], reviewOf: null, reviewRound: 0, assignee: null, summary: null,
  files: [], branch: null, feedback: null, pausedFrom: null, createdAt: 1, updatedAt: 1, ...over
})

describe('task state machine', () => {
  it('allows the normal path to approval', () => {
    expect(canMove('todo', 'in_progress')).toBe(true)
    expect(canMove('in_progress', 'done_pending_review')).toBe(true)
    expect(canMove('done_pending_review', 'in_review')).toBe(true)
    expect(canMove('in_review', 'approved')).toBe(true)
  })
  it('rejects moves out of final states', () => {
    expect(isFinal('approved')).toBe(true)
    expect(canMove('approved', 'in_progress')).toBe(false)
    expect(() => moveTask(task({ status: 'cancelled' }), 'todo', 2)).toThrow(/cannot move/i)
  })
  it('returns a new object and stamps updatedAt', () => {
    const before = task()
    const after = moveTask(before, 'in_progress', 5)
    expect(after).not.toBe(before)
    expect(before.status).toBe('todo')
    expect(after).toMatchObject({ status: 'in_progress', updatedAt: 5 })
  })
  it('pauses from any open state and resumes where it was', () => {
    const paused = pauseTask(task({ status: 'in_review' }), 'waiting_on_human', 3)
    expect(paused).toMatchObject({ status: 'waiting_on_human', pausedFrom: 'in_review' })
    expect(resumeTask(paused, 4)).toMatchObject({ status: 'in_review', pausedFrom: null })
    expect(() => pauseTask(task({ status: 'approved' }), 'blocked', 3)).toThrow()
    expect(() => resumeTask(task({ status: 'in_progress' }), 3)).toThrow(/not paused/i)
  })
})
```

**Step 2:** `npx vitest run tests/unit/orchTaskMachine.test.ts` → FAIL (module not found).

**Step 3: Implement.** `types.ts` exports `OrchRole`, `TaskStatus`, `OrchTask` (fields as in the test),
`OrchRun`, `OrchAgent`, `OrchMessage`, `OrchNote`, `OrchDecision`, `OrchEvent`. `taskMachine.ts` holds a
`TRANSITIONS` table and `canMove`, `isFinal`, `moveTask`, `pauseTask`, `resumeTask`; all return new objects.

**Step 4:** run the test → PASS. **Step 5:** commit `feat(orch): task types and state machine`.

### Task 2: Roles and tool schemas

**Files:**
- Create: `src/shared/orch/roles.ts`, `src/shared/orch/toolSchemas.ts`
- Test: `tests/unit/orchRoles.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { REVIEWER_FOR, ROLE_TOOLS, canUseTool } from '../../src/shared/orch/roles'
import { TOOL_SCHEMAS, validateArgs } from '../../src/shared/orch/toolSchemas'

describe('roles', () => {
  it('gives the lead planning tools and workers task tools', () => {
    expect(canUseTool('lead', 'create_task')).toBe(true)
    expect(canUseTool('implementer', 'create_task')).toBe(false)
    expect(canUseTool('implementer', 'complete_task')).toBe(true)
    expect(canUseTool('code-reviewer', 'submit_review')).toBe(true)
    expect(canUseTool('code-reviewer', 'complete_task')).toBe(false)
  })
  it('lets every role ask the human', () => {
    for (const tools of Object.values(ROLE_TOOLS)) expect(tools).toContain('ask_human')
  })
  it('routes implementer and ui work to the code reviewer', () => {
    expect(REVIEWER_FOR.implementer).toBe('code-reviewer')
    expect(REVIEWER_FOR.ui).toBe('code-reviewer')
    expect(REVIEWER_FOR.tester).toBeUndefined()
  })
  it('has a schema for every tool a role can use', () => {
    const names = new Set(TOOL_SCHEMAS.map((t) => t.name))
    for (const tools of Object.values(ROLE_TOOLS)) for (const t of tools) expect(names.has(t)).toBe(true)
  })
  it('validates required arguments and types', () => {
    expect(validateArgs('create_task', { title: 'a', spec: 'b', role: 'ui' })).toBeNull()
    expect(validateArgs('create_task', { spec: 'b', role: 'ui' })).toMatch(/title/)
    expect(validateArgs('create_task', { title: 'a', spec: 'b', role: 'pilot' })).toMatch(/role/)
    expect(validateArgs('submit_review', { verdict: 'maybe' })).toMatch(/verdict/)
  })
})
```

**Step 2:** run → FAIL. **Step 3:** implement `ROLE_TOOLS` (common: `whoami, list_agents, send_message,
fetch_inbox, put_note, get_notes, ask_human`; lead adds `create_task, list_tasks`; workers add
`get_my_task, update_task, complete_task, block_task`; reviewers add `get_my_task, submit_review,
block_task`), `REVIEWER_FOR`, `canUseTool`; `TOOL_SCHEMAS` (name, description written for agents,
JSON-schema `inputSchema`) and `validateArgs` (required keys, string/array/enum checks).
**Step 4:** PASS. **Step 5:** commit `feat(orch): roles and tool schemas`.

### Task 3: SQLite store

**Files:**
- Create: `src/main/orch/store.ts`
- Test: `tests/unit/orchStore.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { OrchStore } from '../../src/main/orch/store'

describe('OrchStore', () => {
  it('round-trips runs, tasks, agents, messages, notes, decisions and events', () => {
    const s = new OrchStore(':memory:')
    s.putRun({ id: 'r1', projectPath: 'C:/p', title: 'Story', story: 's', plan: 'Default', stage: 'build', createdAt: 1, finishedAt: null })
    expect(s.getRun('r1')?.title).toBe('Story')
    expect(s.nextTaskNumber('r1')).toBe(1)
    s.putTask({ id: 'r1:T-1', key: 'T-1', runId: 'r1', title: 't', spec: '', role: 'ui', status: 'todo', dependsOn: [], acceptance: [], reviewOf: null, reviewRound: 0, assignee: null, summary: null, files: [], branch: null, feedback: null, pausedFrom: null, createdAt: 1, updatedAt: 1 })
    expect(s.nextTaskNumber('r1')).toBe(2)
    expect(s.listTasks({ runId: 'r1', status: 'todo' })).toHaveLength(1)
    s.putAgent({ id: 'a1', runId: 'r1', role: 'ui', runner: 'claude', model: 'sonnet', token: 'tok', taskId: null, createdAt: 1 })
    expect(s.agentByToken('tok')?.id).toBe('a1')
    s.putMessage({ id: 'm1', runId: 'r1', from: 'a0', to: 'a1', taskId: null, body: 'hi', createdAt: 1, readAt: null })
    expect(s.unreadFor('a1')).toHaveLength(1)
    s.putNote({ runId: 'r1', key: 'k', text: 'v', author: 'a1', updatedAt: 1 })
    expect(s.listNotes('r1')[0].text).toBe('v')
    s.addEvent({ runId: 'r1', at: 1, kind: 'task', text: 'created', taskId: 'r1:T-1' })
    expect(s.listEvents('r1')).toHaveLength(1)
  })
  it('keeps data in a file between instances', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const file = join(mkdtempSync(join(tmpdir(), 'orch-')), 'orch.db')
    const a = new OrchStore(file)
    a.putRun({ id: 'r9', projectPath: 'p', title: 'kept', story: '', plan: 'x', stage: 'spec', createdAt: 1, finishedAt: null })
    a.close()
    expect(new OrchStore(file).getRun('r9')?.title).toBe('kept')
  })
})
```

**Step 2:** run → FAIL. **Step 3:** implement with `DatabaseSync`, WAL mode, tables `runs, tasks, agents,
messages, notes, decisions, events` (indexed columns + JSON `data`), prepared statements, `close()`.
**Step 4:** PASS. **Step 5:** commit `feat(orch): sqlite store`.

### Task 4: Orch service: tasks, claiming, completing

**Files:**
- Create: `src/main/orch/service.ts`
- Test: `tests/unit/orchService.test.ts`

**Step 1: Write the failing tests** (helpers create a run and agents through the host API):

```ts
import { describe, expect, it } from 'vitest'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'

function setup() {
  let t = 0
  const svc = new OrchService(new OrchStore(':memory:'), () => (t += 1))
  const run = svc.createRun({ projectPath: 'C:/p', title: 'CSV export', story: 'As a user…', plan: 'Default' })
  const lead = svc.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })
  const impl = svc.registerAgent({ runId: run.id, role: 'implementer', runner: 'codex', model: 'gpt' })
  const rev = svc.registerAgent({ runId: run.id, role: 'code-reviewer', runner: 'claude', model: 'sonnet' })
  return { svc, run, lead, impl, rev }
}

describe('OrchService tasks', () => {
  it('lets the lead create tasks and a worker claim them in dependency order', () => {
    const { svc, lead, impl } = setup()
    const a = svc.call(lead, 'create_task', { title: 'Query', spec: 's', role: 'implementer' }) as { key: string }
    svc.call(lead, 'create_task', { title: 'Writer', spec: 's', role: 'implementer', depends_on: [a.key] })
    const mine = svc.call(impl, 'get_my_task', {}) as { key: string; status: string }
    expect(mine).toMatchObject({ key: 'T-1', status: 'in_progress' })
    expect(svc.call(impl, 'get_my_task', {})).toMatchObject({ key: 'T-1' })
  })
  it('refuses tools outside the role', () => {
    const { svc, impl } = setup()
    expect(() => svc.call(impl, 'create_task', { title: 'x', spec: 'y', role: 'ui' })).toThrow(/not allowed/i)
  })
  it('sends finished implementer work to review and runs the reject/approve loop', () => {
    const { svc, lead, impl, rev } = setup()
    svc.call(lead, 'create_task', { title: 'Writer', spec: 's', role: 'implementer' })
    svc.call(impl, 'get_my_task', {})
    svc.call(impl, 'complete_task', { summary: 'done', files: ['a.ts'] })
    const review = svc.call(rev, 'get_my_task', {}) as { key: string; reviewOf: string }
    expect(review.reviewOf).toBe('T-1')
    expect(svc.task('T-1', impl.runId).status).toBe('in_review')
    svc.call(rev, 'submit_review', { verdict: 'reject', comments: 'BOM missing' })
    expect(svc.task('T-1', impl.runId)).toMatchObject({ status: 'in_progress', reviewRound: 1, feedback: 'BOM missing' })
    expect((svc.call(impl, 'fetch_inbox', {}) as { body: string }[])[0].body).toMatch(/BOM missing/)
    svc.call(impl, 'complete_task', { summary: 'fixed' })
    svc.call(rev, 'get_my_task', {})
    svc.call(rev, 'submit_review', { verdict: 'approve', comments: 'ok' })
    expect(svc.task('T-1', impl.runId).status).toBe('approved')
  })
  it('escalates to the human after the second rejection', () => {
    const { svc, lead, impl, rev } = setup()
    svc.call(lead, 'create_task', { title: 'W', spec: 's', role: 'implementer' })
    for (let round = 0; round < 2; round += 1) {
      svc.call(impl, 'get_my_task', {})
      svc.call(impl, 'complete_task', { summary: 'try' })
      svc.call(rev, 'get_my_task', {})
      svc.call(rev, 'submit_review', { verdict: 'reject', comments: `no ${round}` })
    }
    expect(svc.task('T-1', impl.runId).status).toBe('waiting_on_human')
    expect(svc.openDecisions()).toEqual([expect.objectContaining({ kind: 'escalation' })])
  })
})
```

**Step 2:** run → FAIL. **Step 3:** implement `OrchService` with `createRun`, `registerAgent` (random
token via `crypto.randomBytes(24).toString('base64url')`), `call(agent, tool, args)` (validate → permission
→ dispatch), `task(key, runId)`, `openDecisions()`, and tool handlers for `whoami, list_agents,
create_task, list_tasks, get_my_task, update_task, complete_task, block_task, submit_review,
send_message, fetch_inbox, put_note, get_notes`. Every change writes an event.
**Step 4:** PASS. **Step 5:** commit `feat(orch): service with task flow and reviews`.

### Task 5: Human decisions

**Files:** Modify `src/main/orch/service.ts`; Test: `tests/unit/orchHuman.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'

function setup() {
  let t = 0
  const svc = new OrchService(new OrchStore(':memory:'), () => (t += 1))
  const run = svc.createRun({ projectPath: 'C:/p', title: 'x', story: 's', plan: 'Default' })
  const lead = svc.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })
  const impl = svc.registerAgent({ runId: run.id, role: 'implementer', runner: 'codex', model: 'gpt' })
  const spec = svc.registerAgent({ runId: run.id, role: 'spec-writer', runner: 'claude', model: 'sonnet' })
  return { svc, run, lead, impl, spec }
}

describe('human decisions', () => {
  it('pauses the task on ask_human and resumes it with the answer', () => {
    const { svc, lead, impl } = setup()
    svc.call(lead, 'create_task', { title: 'Cost', spec: 's', role: 'implementer' })
    svc.call(impl, 'get_my_task', {})
    const asked = svc.call(impl, 'ask_human', { question: 'Price others?', options: ['Yes', 'No'], recommended: 0 }) as { decision_id: string }
    expect(svc.task('T-1', impl.runId).status).toBe('waiting_on_human')
    svc.answerDecision(asked.decision_id, 'Yes, mark estimated')
    expect(svc.task('T-1', impl.runId).status).toBe('in_progress')
    expect((svc.call(impl, 'fetch_inbox', {}) as { body: string }[])[0].body).toMatch(/Yes, mark estimated/)
    expect((svc.call(impl, 'get_notes', {}) as { key: string }[]).map((n) => n.key)).toContain(`decision:${asked.decision_id}`)
  })
  it('turns a finished spec into a spec-approval decision', () => {
    const { svc, lead, spec } = setup()
    svc.call(lead, 'create_task', { title: 'Spec', spec: 'story', role: 'spec-writer' })
    svc.call(spec, 'get_my_task', {})
    svc.call(spec, 'complete_task', { summary: 'spec v1', files: ['spec.md'] })
    const [d] = svc.openDecisions()
    expect(d.kind).toBe('spec-approval')
    svc.answerDecision(d.id, 'Add totals per project')
    expect(svc.task('T-1', spec.runId)).toMatchObject({ status: 'in_progress', feedback: 'Add totals per project' })
    svc.call(spec, 'complete_task', { summary: 'spec v2' })
    svc.answerDecision(svc.openDecisions()[0].id, 'Approve')
    expect(svc.task('T-1', spec.runId).status).toBe('approved')
  })
  it('never lets an agent answer a decision', () => {
    const { svc } = setup()
    expect(svc.openDecisions()).toEqual([])
    expect(() => svc.answerDecision('missing', 'x')).toThrow(/not found/i)
  })
})
```

**Step 2:** FAIL. **Step 3:** implement `ask_human`, `answerDecision`, spec-approval and escalation
answers (escalation answers: `Try again` → back to `in_progress`, round reset; anything else → note + resume).
**Step 4:** PASS. **Step 5:** commit `feat(orch): human decisions`.

### Task 5b: Task export and handoff to another model

**Files:** Modify `src/shared/orch/types.ts` (`OrchTaskState`), `src/main/orch/store.ts` (`listMessages`),
`src/main/orch/service.ts` (`exportTaskState`, `handoffTask`, brief builder); Test: `tests/unit/orchHandoff.test.ts`
(export contents and brief; handoff of a working task; handoff mid-review keeps round and feedback;
finished tasks refuse). Commit `feat(orch): export task state and hand off to another model`.

### Task 6: MCP server

**Files:**
- Create: `src/main/orch/mcpServer.ts`, `tests/support/orchMcpClient.ts`
- Test: `tests/unit/orchMcpServer.test.ts`

**Step 1: Write the failing tests** (`orchMcpClient.ts` posts JSON-RPC with `fetch`):

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { startOrchMcpServer, type OrchMcpServer } from '../../src/main/orch/mcpServer'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'
import { McpTestClient } from '../support/orchMcpClient'

const servers: OrchMcpServer[] = []
afterEach(async () => { for (const s of servers.splice(0)) await s.close() })

async function boot() {
  const svc = new OrchService(new OrchStore(':memory:'))
  const server = await startOrchMcpServer(svc)
  servers.push(server)
  const run = svc.createRun({ projectPath: 'C:/p', title: 'x', story: 's', plan: 'Default' })
  const lead = svc.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })
  const impl = svc.registerAgent({ runId: run.id, role: 'implementer', runner: 'codex', model: 'gpt' })
  return { svc, server, lead, impl, url: server.url }
}

describe('orch MCP server', () => {
  it('initializes and lists only the tools for the agent role', async () => {
    const { url, impl } = await boot()
    const c = new McpTestClient(url, impl.token)
    const init = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    expect(init.result.serverInfo.name).toBe('dawsha-orch')
    expect((await c.notify('notifications/initialized')).status).toBe(202)
    const names = (await c.request('tools/list')).result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('complete_task')
    expect(names).not.toContain('create_task')
  })
  it('runs tool calls and reports tool errors as isError', async () => {
    const { url, lead, impl } = await boot()
    const l = new McpTestClient(url, lead.token)
    const created = await l.callTool('create_task', { title: 'A', spec: 's', role: 'implementer' })
    expect(created.isError).toBeFalsy()
    const i = new McpTestClient(url, impl.token)
    expect((await i.callTool('get_my_task', {})).json.key).toBe('T-1')
    const denied = await i.callTool('create_task', { title: 'B', spec: 's', role: 'ui' })
    expect(denied.isError).toBe(true)
  })
  it('rejects missing tokens, foreign origins and huge bodies', async () => {
    const { url, impl } = await boot()
    expect((await new McpTestClient(url, 'wrong').raw('{}')).status).toBe(401)
    expect((await new McpTestClient(url, impl.token, 'https://evil.example').raw('{}')).status).toBe(403)
    expect((await new McpTestClient(url, impl.token).raw('x'.repeat(1_100_000))).status).toBe(413)
    expect((await new McpTestClient(url, impl.token).raw('{"jsonrpc":"2.0","id":1,"method":"nope"}')).json.error.code).toBe(-32601)
  })
})
```

**Step 2:** FAIL. **Step 3:** implement `startOrchMcpServer(service, { port? })` → `{ url, port, close() }`
on `127.0.0.1`; JSON-RPC parse errors → -32700, unknown method → -32601, invalid params → -32602; tool
results as `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`, thrown tool errors as
`isError: true` with the message. **Step 4:** PASS. **Step 5:** commit `feat(orch): local MCP server`.

### Task 7: Full run through MCP with fake agents

**Files:** Test: `tests/unit/orchFullRun.test.ts`

**Step 1: Write the test:** a lead, spec writer, implementer, reviewer and tester (all `McpTestClient`s)
walk a whole run over HTTP: spec task → spec approval answered `Approve` → lead creates implementer and
tester tasks (tester depends on implementer) → implementer completes → reviewer rejects once, then
approves → tester claims only after approval and completes → all tasks `approved`; the event log holds
every step in order. **Step 2:** run → should PASS if tasks 1–6 are right; fix bugs it reveals.
**Step 3:** commit `test(orch): full run over MCP`.

### Task 8: Experimental switch and startup wiring

**Files:**
- Modify: `src/shared/types.ts` (Settings: `experimental: { orchestrator: boolean }`),
  `src/shared/settingsSchema.ts` (default `false`, sanitize), `src/main/index.ts` (start/stop)
- Create: `src/main/orch/runtime.ts`
- Test: `tests/unit/settings.test.ts` (add cases), `tests/unit/orchRuntime.test.ts`

**Step 1: Failing tests:** settings default `experimental.orchestrator === false` and non-boolean values
sanitize to `false`; `OrchRuntime.start(dbPath)` opens the store and server and `stop()` closes both
(idempotent). **Step 2:** FAIL. **Step 3:** implement; in `index.ts` start the runtime after settings load
when the flag is on (db at `userData/orchestrator.db`), stop on `will-quit`.
**Step 4:** `npm run test:unit` and `npm run typecheck` → all pass. **Step 5:** commit
`feat(orch): experimental orchestrator switch`.

### Task 9: Verify

Run `npm run typecheck`, `npm run test:unit`. Then a manual smoke test: start the runtime from a scratch
script, register an agent, and connect a real Claude Code session with
`claude --mcp-config <json with the server url and bearer header>` and ask it to call `whoami`.
