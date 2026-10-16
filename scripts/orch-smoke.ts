// Manual smoke test: starts the orch server, gives a real agent CLI a task and checks it used the tools.
// Run: npx vite-node scripts/orch-smoke.ts [claude|codex]
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrchRuntime } from '../src/main/orch/runtime'

const runner = process.argv[2] === 'codex' ? 'codex' : 'claude'
const dir = mkdtempSync(join(tmpdir(), 'orch-smoke-'))
const runtime = new OrchRuntime(join(dir, 'orchestrator.db'), 'smoke')
const server = await runtime.start()
const svc = runtime.service!
const run = svc.createRun({ projectPath: dir, title: 'Smoke test', story: 'Check the orch tools work.', plan: 'Default' })
const lead = svc.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })
svc.call(lead, 'create_task', { title: 'Say hello', spec: 'Do not edit files. Just complete the task with the summary "hello from the agent".', role: 'tester' })
const agent = svc.registerAgent({ runId: run.id, role: 'tester', runner, model: 'default' })

const prompt = 'You are connected to the dawsha-orch MCP server. Call its whoami tool, then get_my_task, then complete_task exactly as the task spec says. Reply with the task title.'
let command: string
let args: string[]
if (runner === 'claude') {
  const config = join(dir, 'mcp.json')
  writeFileSync(config, JSON.stringify({ mcpServers: { 'dawsha-orch': { type: 'http', url: server.url, headers: { Authorization: `Bearer ${agent.token}` } } } }))
  command = 'claude'
  args = ['-p', prompt, '--mcp-config', config, '--strict-mcp-config', '--allowedTools', 'mcp__dawsha-orch', '--model', 'haiku']
} else {
  process.env.ORCH_TOKEN = agent.token
  command = 'codex'
  args = ['exec', '--skip-git-repo-check', '-s', 'read-only', '-C', dir,
    '-c', `mcp_servers.dawsha-orch.url="${server.url}"`,
    '-c', 'mcp_servers.dawsha-orch.bearer_token_env_var="ORCH_TOKEN"',
    // Codex otherwise asks before every MCP call, and `exec` cannot ask, so it refuses them.
    '-c', 'mcp_servers.dawsha-orch.default_tools_approval_mode="approve"',
    '-']
}

// The Windows shell splits unquoted arguments, so the Codex prompt goes through stdin.
const child = spawn(command, args.map((a) => (a === prompt ? `"${a}"` : a)), { cwd: dir, shell: process.platform === 'win32', env: process.env })
if (runner === 'codex') child.stdin.end(prompt)
let output = ''
child.stdout.on('data', (d) => (output += d))
child.stderr.on('data', (d) => (output += d))
const timer = setTimeout(() => child.kill(), 240_000)
const code: number = await new Promise((resolve) => child.on('close', resolve))
clearTimeout(timer)

const task = svc.task('T-1', run.id)
console.log(`--- ${runner} exited ${code}\n${output.trim().split('\n').slice(-8).join('\n')}`)
console.log('--- task:', task.status, '|', task.summary)
console.log('--- events:\n' + svc.events(run.id).map((e) => `  ${e.text}`).join('\n'))
await runtime.stop()
process.exit(task.status === 'approved' ? 0 : 1)
