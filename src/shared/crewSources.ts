import type { AgentKind } from './types'

export interface CrewSourceFile {
  id: string
  kind: 'agent' | 'skill' | 'prompt'
  agent: AgentKind | 'shared'
  scope: 'user' | 'project'
  project?: string
  /** The file the member links to: the agent file, the skill's SKILL.md or the prompt file. */
  path: string
  /** The skill's name, or the agent or prompt file name. */
  fileName: string
  text: string
}
