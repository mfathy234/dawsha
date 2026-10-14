import type { AgentKind } from './types'

export interface BulkSkillExport {
  folder: string
  exported: number
  skipped: { name: string; reason: string }[]
}

export interface SkillEntry {
  id: string
  name: string
  kind: 'skill' | 'agent'
  agent: AgentKind | 'shared'
  scope: 'user' | 'project'
  path: string
  project?: string
}
