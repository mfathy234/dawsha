// A stand-in for Claude Code in orchestrator e2e tests: it connects to Dawsha's orch MCP server the way the
// real CLI would (URL from --mcp-config, token from DAWSHA_ORCH_TOKEN), takes its task, commits a change in
// its worktree, completes the task, then stays open like an interactive agent.
const { readFileSync, writeFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')

const args = process.argv.slice(2)
const configPath = args[args.indexOf('--mcp-config') + 1]
const say = (text) => process.stdout.write(`${text}\r\n`)

async function main() {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const server = Object.values(config.mcpServers)[0]
  const token = process.env.DAWSHA_ORCH_TOKEN
  let id = 0
  const rpc = async (method, params) => {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
    })
    return (await res.json()).result
  }
  const tool = async (name, args) => JSON.parse((await rpc('tools/call', { name, arguments: args })).content[0].text)
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-orch-agent', version: '1' } })
  const me = await tool('whoami', {})
  say(`fake agent ${me.role} in run "${me.run_title}"`)
  const task = await tool('get_my_task', {})
  say(`working on ${task.key}: ${task.title}`)
  writeFileSync('fix.txt', `fixed: ${task.title}\n`)
  const git = (...a) => execFileSync('git', ['-c', 'user.name=Fake Agent', '-c', 'user.email=fake@example.invalid', ...a], { encoding: 'utf8' })
  git('add', 'fix.txt')
  git('commit', '-q', '-m', `fix: ${task.title}`)
  const result = await tool('complete_task', { summary: 'Guarded the empty range', files: ['fix.txt'], tests: 'none' })
  say(`completed ${task.key}: ${result.status}`)
  setInterval(() => undefined, 60_000)
}

main().catch((error) => {
  say(`fake agent failed: ${error.message}`)
  setInterval(() => undefined, 60_000)
})
