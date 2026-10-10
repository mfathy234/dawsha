import type { AgentKind } from './types'

export interface SkillEntry {
  id: string
  name: string
  kind: 'skill' | 'agent'
  agent: AgentKind | 'shared'
  scope: 'user' | 'project'
  path: string
  project?: string
}
