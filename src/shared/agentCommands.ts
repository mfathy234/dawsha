import type { AgentKind } from './types'

export interface AgentCommand { name: string; description: string }

const commands: Record<'claude' | 'codex', readonly AgentCommand[]> = {
  claude: [
    ['/help', 'Show help'], ['/clear', 'Clear conversation'], ['/compact', 'Compact conversation'], ['/model', 'Choose a model'],
    ['/review', 'Review code'], ['/resume', 'Resume a session'], ['/init', 'Initialize project guidance'], ['/memory', 'Edit memory'],
    ['/cost', 'Show token usage'], ['/context', 'Show context usage'], ['/agents', 'Manage agents'], ['/mcp', 'Manage MCP servers'],
    ['/permissions', 'Manage permissions'], ['/config', 'Open settings'], ['/status', 'Show session status'], ['/rewind', 'Rewind conversation']
  ].map(([name, description]) => ({ name, description })),
  codex: [
    ['/model', 'Choose a model'], ['/approvals', 'Change approval policy'], ['/review', 'Review code'], ['/new', 'Start a new session'],
    ['/init', 'Initialize project guidance'], ['/compact', 'Compact conversation'], ['/diff', 'Show working tree diff'], ['/mention', 'Mention a file'],
    ['/status', 'Show session status'], ['/mcp', 'Manage MCP servers'], ['/logout', 'Sign out'], ['/quit', 'Exit Codex']
  ].map(([name, description]) => ({ name, description }))
}

export const agentCommands = (agent: AgentKind): readonly AgentCommand[] => agent === 'claude' || agent === 'codex' ? commands[agent] : []
