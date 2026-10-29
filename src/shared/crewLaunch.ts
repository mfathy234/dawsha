import { INSTRUCTIONS_MAX, type CrewLaunch, type CrewMember, type CrewPermissions } from './crew'
import type { AgentKind } from './types'

export const READ_ONLY_NOTE =
  'You are read only. Do not edit, create, delete or move files, do not run commands that change anything, and do not commit or push. Look, read, and report.'

export const CODEX_SANDBOX_NOTE = 'Codex runs with full access on this PC because its sandbox does not work here, so read only is an instruction, not a lock.'

export function composeInstructions(member: Pick<CrewMember, 'instructions' | 'source' | 'permissions'>, runner: AgentKind): string {
  const parts = [member.instructions.trim()]
  const { kind, path } = member.source
  if (kind === 'skill' && runner !== 'claude' && path !== '' && !parts[0].includes(path)) {
    parts.push(`Before you start, read the skill file at ${path} and follow it.`)
  }
  if (member.permissions === 'read' && runner !== 'claude') parts.push(READ_ONLY_NOTE)
  return parts.filter((part) => part !== '').join('\n\n').slice(0, INSTRUCTIONS_MAX)
}

/** Codex's sandbox fails on this PC, so its members always run with full access; Gemini follows the member. */
export function crewFullAccess(runner: AgentKind, permissions: CrewPermissions): boolean {
  if (runner === 'codex') return true
  return permissions === 'full'
}

const CODEX_EFFORT: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' }

export interface CrewArgsOptions {
  emptyMcpConfig: string
  projectMcpConfig?: string | null
}

/**
 * The flags that make a CLI behave as a crew member. They go through the spawn argument list, never a shell string.
 * Claude's --mcp-config takes several values, so the instructions flag follows it and ends the list.
 */
export function crewArgs(runner: AgentKind, launch: CrewLaunch, options: CrewArgsOptions): string[] {
  if (runner === 'claude') {
    const args: string[] = []
    if (launch.model) args.push('--model', launch.model)
    if (launch.effort) args.push('--effort', launch.effort)
    if (launch.permissions === 'read') args.push('--permission-mode', 'plan')
    if (launch.startup !== 'usual') {
      const config = launch.startup === 'some' && options.projectMcpConfig ? options.projectMcpConfig : options.emptyMcpConfig
      args.push('--strict-mcp-config', '--mcp-config', config)
    }
    if (launch.instructions) args.push('--append-system-prompt', launch.instructions)
    return args
  }
  const args: string[] = []
  if (launch.model) args.push('-m', launch.model)
  if (runner === 'codex' && launch.effort && CODEX_EFFORT[launch.effort]) args.push('-c', `model_reasoning_effort=${CODEX_EFFORT[launch.effort]}`)
  return args
}

/** Codex and Gemini have no system-prompt flag, so the instructions travel in front of the first message. */
export function crewPrompt(runner: AgentKind, launch: CrewLaunch, prompt: string): string {
  if (runner === 'claude' || launch.instructions === '') return prompt
  const block = `<instructions>\n${launch.instructions}\n</instructions>`
  return prompt === '' ? block : `${block}\n\n${prompt}`
}

export function commandPreview(runner: AgentKind, launch: CrewLaunch, member: Pick<CrewMember, 'name' | 'role'>): string {
  const first = runner === 'claude' ? 'claude' : runner
  const flags = crewArgs(runner, launch, { emptyMcpConfig: '<empty-mcp.json>' }).map((arg, index, all) => {
    if (all[index - 1] === '--append-system-prompt') return `"<${member.name}${member.role ? `, ${member.role}` : ''}>"`
    return arg
  })
  if (crewFullAccess(runner, launch.permissions)) flags.push(runner === 'claude' ? '--dangerously-skip-permissions' : runner === 'codex' ? '--dangerously-bypass-approvals-and-sandbox' : '--yolo')
  const tail = runner === 'claude' ? '"…"' : '"<instructions>… + the job"'
  return [first, ...flags, tail].join(' ')
}
