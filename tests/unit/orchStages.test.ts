import { describe, expect, it } from 'vitest'
import { currentStageIndex, stagesOf } from '../../src/renderer/components/orch/orchUi'
import type { OrchRunDetail } from '../../src/shared/orch/api'

type Run = Pick<OrchRunDetail, 'kind' | 'stage' | 'tasks'>
const spec = (status: string) => ({ role: 'spec-writer', status }) as OrchRunDetail['tasks'][number]
const labels = (run: Run) => stagesOf(run).map((s) => s.label)
const current = (run: Run) => labels(run)[currentStageIndex(run)]

describe('run stages', () => {
  it('shows Plan, Build, Merge, Done for a feature without a spec, and no Spec step', () => {
    const run: Run = { kind: 'feature', stage: 'plan', tasks: [] }
    expect(labels(run)).toEqual(['Plan', 'Build', 'Merge', 'Done'])
    expect(current(run)).toBe('Plan')
    expect(current({ ...run, stage: 'review' })).toBe('Build')
  })

  it('adds Spec after Plan when the lead asked for one, and counts planning after the spec as Build', () => {
    expect(labels({ kind: 'feature', stage: 'spec', tasks: [spec('in_progress')] })).toEqual(['Plan', 'Spec', 'Build', 'Merge', 'Done'])
    expect(current({ kind: 'feature', stage: 'spec', tasks: [spec('in_progress')] })).toBe('Spec')
    expect(current({ kind: 'feature', stage: 'plan', tasks: [spec('approved')] })).toBe('Build')
  })

  it('keeps bug runs to Build, Merge, Done', () => {
    expect(labels({ kind: 'bug', stage: 'build', tasks: [] })).toEqual(['Build', 'Merge', 'Done'])
  })
})
