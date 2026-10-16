import { describe, expect, it } from 'vitest'
import { ORCH_TOKEN_ENV, agentRunnerName, buildLaunch, supportsEffort } from '../../src/shared/orch/launch'
import type { OrchProfile } from '../../src/shared/orch/profiles'
import { firstMessage } from '../../src/shared/orch/rolePrompts'

const profile = (over: Partial<OrchProfile>): OrchProfile => ({
  id: 'p', name: 'P', role: 'implementer', runner: 'claude', model: '', effort: null, local: false, prompt: '', ...over
})
const base = { mcpUrl: 'http://127.0.0.1:5000/mcp', configDir: 'C:/data/orch/agent-1' }

describe('orchestrator launch builder', () => {
  it('starts Claude with model, effort, session id and the orch server, without the token on disk', () => {
    const launch = buildLaunch({ ...base, profile: profile({ model: 'opus', effort: 'high' }), sessionId: 'abc' })
    expect(launch.agent).toBe('claude')
    expect(launch.args).toEqual([
      '--model', 'opus', '--effort', 'high', '--session-id', 'abc',
      '--mcp-config', 'C:/data/orch/agent-1/claude-mcp.json', '--allowedTools', 'mcp__dawsha-orch'
    ])
    const config = JSON.parse(launch.files[0].content)
    expect(config.mcpServers['dawsha-orch']).toEqual({ type: 'http', url: base.mcpUrl, headers: { Authorization: `Bearer \${${ORCH_TOKEN_ENV}}` } })
  })

  it('starts Codex with effort mapped to its scale, local models through Ollama, and pre-approved orch tools', () => {
    const launch = buildLaunch({ ...base, profile: profile({ runner: 'codex', model: 'qwen3-coder', effort: 'max', local: true }) })
    expect(launch.args).toEqual([
      '-m', 'qwen3-coder', '--oss', '--local-provider', 'ollama',
      '-c', 'model_reasoning_effort="xhigh"',
      '-c', `mcp_servers.dawsha-orch.url="${base.mcpUrl}"`,
      '-c', `mcp_servers.dawsha-orch.bearer_token_env_var="${ORCH_TOKEN_ENV}"`,
      '-c', 'mcp_servers.dawsha-orch.default_tools_approval_mode="approve"'
    ])
    expect(launch.files).toEqual([])
  })

  it('starts Gemini with its own settings file for the orch server and leaves out the model when unset', () => {
    const launch = buildLaunch({ ...base, profile: profile({ runner: 'gemini', effort: 'high' }) })
    expect(launch.args).toEqual([])
    expect(launch.env).toEqual({ GEMINI_CLI_SYSTEM_SETTINGS_PATH: 'C:/data/orch/agent-1/gemini-settings.json' })
    const settings = JSON.parse(launch.files[0].content)
    expect(settings.mcpServers['dawsha-orch']).toMatchObject({ httpUrl: base.mcpUrl, trust: true })
    expect(supportsEffort('gemini')).toBe(false)
  })

  it('registers local models under a free runner name', () => {
    expect(agentRunnerName(profile({ runner: 'codex', local: true }))).toBe('codex-local')
    expect(agentRunnerName(profile({ runner: 'claude' }))).toBe('claude')
  })
})

describe('first message', () => {
  it('tells the agent its run, branch, duties and the rules in one paragraph', () => {
    const text = firstMessage({ role: 'ui', runId: 'run_abc', runTitle: 'Export usage as CSV', branch: 'orch/abc/t-5', extra: 'Prefer existing components.' })
    expect(text).toContain('"Export usage as CSV"')
    expect(text).toContain('whoami, then get_my_task')
    expect(text).toContain('branch orch/abc/t-5')
    expect(text).toContain('.dawsha/runs/run_abc/mockups/')
    expect(text).toContain('Never merge into main')
    expect(text.endsWith('Prefer existing components.')).toBe(true)
    expect(text).not.toContain('\n')
  })

  it('tells a bug fixer it works alone', () => {
    expect(firstMessage({ role: 'fixer', runId: 'r', runTitle: 'Crash on export' })).toContain('with no other agents')
  })
})
