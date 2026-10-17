import { describe, expect, it } from 'vitest'
import { REVIEWER_FOR, ROLE_TOOLS, canUseTool } from '../../src/shared/orch/roles'
import { TOOL_SCHEMAS, validateArgs } from '../../src/shared/orch/toolSchemas'

describe('roles', () => {
  it('gives the lead planning tools and workers task tools', () => {
    expect(canUseTool('lead', 'create_task')).toBe(true)
    expect(canUseTool('implementer', 'create_task')).toBe(false)
    expect(canUseTool('implementer', 'complete_task')).toBe(true)
    expect(canUseTool('code-reviewer', 'submit_review')).toBe(true)
    expect(canUseTool('code-reviewer', 'complete_task')).toBe(false)
  })
  it('lets every role ask the human', () => {
    for (const tools of Object.values(ROLE_TOOLS)) expect(tools).toContain('ask_human')
  })
  it('routes implementer and ui work to the code reviewer', () => {
    expect(REVIEWER_FOR.implementer).toBe('code-reviewer')
    expect(REVIEWER_FOR.ui).toBe('code-reviewer')
    expect(REVIEWER_FOR.tester).toBeUndefined()
  })
  it('has a schema for every tool a role can use', () => {
    const names = new Set(TOOL_SCHEMAS.map((t) => t.name))
    for (const tools of Object.values(ROLE_TOOLS)) for (const t of tools) expect(names.has(t)).toBe(true)
  })
  it('validates required arguments and types', () => {
    expect(validateArgs('create_task', { title: 'a', spec: 'b', role: 'ui' })).toBeNull()
    expect(validateArgs('create_task', { spec: 'b', role: 'ui' })).toMatch(/title/)
    expect(validateArgs('create_task', { title: 'a', spec: 'b', role: 'pilot' })).toMatch(/role/)
    expect(validateArgs('submit_review', { verdict: 'maybe' })).toMatch(/verdict/)
  })
})
