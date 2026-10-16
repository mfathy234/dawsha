import { expect, it } from 'vitest'
import { historyRuns } from '../../src/shared/orch/history'
import type { OrchRunDetail } from '../../src/shared/orch/api'

const run = (id: string, stage = 'done', over: Record<string, unknown> = {}) => ({ id, stage, createdAt: 1, finishedAt: 2, title: 'Report', story: 'CSV', projectPath: 'C:/repo', tasks: [], decisions: [], ...over }) as unknown as OrchRunDetail
it('lists finished, cancelled and imported runs newest first and searches all history fields', () => {
  const runs = [run('active', 'build'), run('done'), run('cancel', 'cancelled', { finishedAt: 5 }), run('import', 'build', { imported: { at: 9, from: 'laptop' }, finishedAt: 6 })]
  expect(historyRuns(runs, { query: '', project: '', result: '' }).map((r) => r.id)).toEqual(['import', 'cancel', 'done'])
  const searchable = run('search', 'done', { tasks: [{ title: 'Workbook' }], decisions: [{ question: 'Delimiter?', answer: 'Semicolon', context: 'Excel' }] })
  for (const query of ['workbook', 'delimiter', 'semicolon', 'excel', 'csv', 'REPORT']) expect(historyRuns([searchable], { query, project: '', result: '' })).toHaveLength(1)
  expect(historyRuns(runs, { query: 'absent', project: '', result: '' })).toEqual([])
  expect(historyRuns(runs, { query: '', project: '', result: 'imported' }).map((r) => r.id)).toEqual(['import'])
  expect(historyRuns(runs, { query: '', project: 'C:/other', result: '' })).toEqual([])
})
