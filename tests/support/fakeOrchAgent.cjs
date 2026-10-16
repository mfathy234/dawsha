// A stand-in for Claude Code in orchestrator e2e tests: it connects to Dawsha's orch MCP server the way the
// real CLI would (URL from --mcp-config, token from DAWSHA_ORCH_TOKEN), takes its task, commits a change in
// its worktree, completes the task, then stays open like an interactive agent.
const { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } = require('node:fs')
const { join } = require('node:path')
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
  if (/^RESTART:/.test(me.story)) {
    if (me.role === 'lead') await tool('set_estimate', { size: 'large', reason: 'Restart fixture' })
    if (me.role === 'lead' && me.story.endsWith('team')) {
      const tasks = await tool('list_tasks', {})
      if (tasks.length === 0) await tool('create_task', { title: 'Restartable task', spec: 's', role: 'implementer' })
    }
    if (me.role !== 'lead') await tool('get_my_task', {})
    return setInterval(() => undefined, 60_000)
  }
  if (me.role === 'lead' && /^ASK:/.test(me.story)) {
    // Like a real lead with an open question: ask while planning, wait for the answer, then plan one task.
    await tool('ask_human', { question: me.story.slice(4).trim() })
    const wait = setInterval(async () => {
      const inbox = await tool('fetch_inbox', {})
      if (!Array.isArray(inbox) || inbox.length === 0) return
      clearInterval(wait)
      say(`got answer: ${inbox[0].body}`)
      await tool('create_task', { title: `Do it: ${inbox[0].body.split(': ').pop()}`, spec: 's', role: 'implementer' })
    }, 500)
    return
  }
  if (me.role === 'lead') {
    // Like a real lead with a story that needs one: ask for a spec first, once.
    const tasks = await tool('list_tasks', {})
    if (Array.isArray(tasks) && tasks.length === 0) await tool('create_task', { title: `Write the spec for "${me.run_title}"`, spec: 'Spec the story.', role: 'spec-writer' })
    return setInterval(() => undefined, 60_000)
  }
  const task = await tool('get_my_task', {})
  say(`working on ${task.key}: ${task.title}`)
  writeFileSync('fix.txt', `fixed: ${task.title}\n`)
  const git = (...a) => execFileSync('git', ['-c', 'user.name=Fake Agent', '-c', 'user.email=fake@example.invalid', ...a], { encoding: 'utf8' })
  if (me.role === 'spec-writer') {
    let version = 0
    const completeSpec = async () => {
      version++
      const folder = join('.dawsha', 'runs', me.run_id)
      mkdirSync(join(folder, 'mockups'), { recursive: true })
      writeFileSync(join(folder, 'spec.md'), `# Goal v${version}\n\nExport **CSV** safely.\n\n- Empty range supported`)
      const previous = join(folder, 'mockups', 'export-dialog.html')
      if (version >= 3 && existsSync(previous)) unlinkSync(previous)
      const name = version >= 3 ? 'export-results.html' : 'export-dialog.html'
      writeFileSync(join(folder, 'mockups', name), `<style>body{background:#fff;color:#18232f;font:16px system-ui;padding:24px}button{padding:8px 16px}section{border:1px solid #ccc;padding:24px}</style><h1>Export dialog v${version}</h1><section><h2>Export usage</h2><p>Save the selected date range as CSV.</p><button>Cancel</button> <button>Export CSV</button></section><script>document.body.dataset.scriptRan='yes'</script>`)
      git('add', folder)
      git('commit', '-q', '-m', `docs: spec v${version}`)
      await tool('complete_task', { summary: `Spec v${version}`, files: [join(folder, 'spec.md'), join(folder, 'mockups', name)] })
    }
    await completeSpec()
    let busy = false
    setInterval(async () => {
      if (busy) return
      busy = true
      try {
        const current = await tool('get_my_task', {})
        if (current.status === 'in_progress') await completeSpec()
      } catch (error) { say(error.message) } finally { busy = false }
    }, 500)
    return
  }
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
