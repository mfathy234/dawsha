import type { OrchRole } from './types'

const COMMON = ['whoami', 'list_agents', 'send_message', 'fetch_inbox', 'put_note', 'get_notes', 'ask_human'] as const
const WORKER = ['get_my_task', 'update_task', 'complete_task', 'block_task'] as const
const REVIEWER = ['get_my_task', 'submit_review', 'block_task'] as const

/** The orch tools each role sees in tools/list and may call. */
export const ROLE_TOOLS: Record<OrchRole, readonly string[]> = {
  // The lead can also take a task itself (create_task with self) and work it like an implementer.
  lead: [...COMMON, 'set_estimate', 'create_task', 'list_tasks', 'cancel_run', ...WORKER],
  'spec-writer': [...COMMON, ...WORKER],
  implementer: [...COMMON, ...WORKER],
  ui: [...COMMON, ...WORKER],
  tester: [...COMMON, ...WORKER],
  fixer: [...COMMON, ...WORKER],
  'code-reviewer': [...COMMON, ...REVIEWER],
  'ux-reviewer': [...COMMON, ...REVIEWER]
}

/** Finished work from these roles is reviewed by the given role before it counts as approved. */
export const REVIEWER_FOR: Partial<Record<OrchRole, OrchRole>> = {
  implementer: 'code-reviewer',
  ui: 'code-reviewer'
}

export const canUseTool = (role: OrchRole, tool: string): boolean => ROLE_TOOLS[role].includes(tool)
