import type { Effort, OrchProfile, OrchRunner } from './profiles'

/** Environment variable that carries the agent's orch token; configs only reference it, so it is never written to disk. */
export const ORCH_TOKEN_ENV = 'DAWSHA_ORCH_TOKEN'
export const ORCH_SERVER_NAME = 'dawsha-orch'

export interface LaunchInput {
  profile: OrchProfile
  mcpUrl: string
  /** Folder for per-agent config files (inside Dawsha's user data). */
  configDir: string
  /** Fixed CLI session id where the CLI supports one, so usage can be matched to the agent. */
  sessionId?: string
}

export interface OrchLaunch {
  agent: OrchRunner
  /** Added to the agent's normal launch arguments, before the initial prompt. */
  args: string[]
  /** Extra environment, without the token (added by the main process at spawn). */
  env: Record<string, string>
  /** Config files to write before spawning. */
  files: { path: string; content: string }[]
}

const CODEX_EFFORT: Record<Effort, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' }

const join = (dir: string, name: string): string => `${dir.replace(/[\\/]+$/, '')}/${name}`

function claudeLaunch(input: LaunchInput): OrchLaunch {
  const { profile, mcpUrl, configDir, sessionId } = input
  const mcpPath = join(configDir, 'claude-mcp.json')
  const mcp = { mcpServers: { [ORCH_SERVER_NAME]: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer \${${ORCH_TOKEN_ENV}}` } } } }
  return {
    agent: 'claude',
    args: [
      ...(profile.model ? ['--model', profile.model] : []),
      ...(profile.effort ? ['--effort', profile.effort] : []),
      ...(sessionId ? ['--session-id', sessionId] : []),
      '--mcp-config', mcpPath,
      '--allowedTools', `mcp__${ORCH_SERVER_NAME}`
    ],
    env: {},
    files: [{ path: mcpPath, content: JSON.stringify(mcp, null, 2) }]
  }
}

function codexLaunch(input: LaunchInput): OrchLaunch {
  const { profile, mcpUrl } = input
  const server = `mcp_servers.${ORCH_SERVER_NAME}`
  return {
    agent: 'codex',
    args: [
      ...(profile.model ? ['-m', profile.model] : []),
      ...(profile.local ? ['--oss', '--local-provider', 'ollama'] : []),
      ...(profile.effort ? ['-c', `model_reasoning_effort="${CODEX_EFFORT[profile.effort]}"`] : []),
      '-c', `${server}.url="${mcpUrl}"`,
      '-c', `${server}.bearer_token_env_var="${ORCH_TOKEN_ENV}"`,
      // Without this Codex asks before every orch call, and refuses them when it cannot ask.
      '-c', `${server}.default_tools_approval_mode="approve"`
    ],
    env: {},
    files: []
  }
}

function geminiLaunch(input: LaunchInput): OrchLaunch {
  const { profile, mcpUrl, configDir, sessionId } = input
  const settingsPath = join(configDir, 'gemini-settings.json')
  const settings = {
    mcpServers: { [ORCH_SERVER_NAME]: { httpUrl: mcpUrl, headers: { Authorization: `Bearer $${ORCH_TOKEN_ENV}` }, trust: true } }
  }
  return {
    agent: 'gemini',
    args: [...(profile.model ? ['-m', profile.model] : []), ...(sessionId ? ['--session-id', sessionId] : [])],
    env: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsPath },
    files: [{ path: settingsPath, content: JSON.stringify(settings, null, 2) }]
  }
}

export function buildLaunch(input: LaunchInput): OrchLaunch {
  switch (input.profile.runner) {
    case 'claude':
      return claudeLaunch(input)
    case 'codex':
      return codexLaunch(input)
    case 'gemini':
      return geminiLaunch(input)
  }
}

/** The runner name an agent is registered under: local models get `-local`, which prices them as free. */
export const agentRunnerName = (profile: OrchProfile): string => (profile.local ? `${profile.runner}-local` : profile.runner)

/** Whether the runner can take an effort level at all (shown as "not supported" otherwise). */
export const supportsEffort = (runner: OrchRunner): boolean => runner !== 'gemini'
