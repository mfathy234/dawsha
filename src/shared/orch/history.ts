import type { OrchRunDetail } from './api'
import { isFinishedRun } from './board'

export interface HistoryFilter { query: string; project: string; result: string }
export const historyResult = (run: OrchRunDetail): string => run.imported ? 'imported' : run.stage === 'cancelled' ? 'cancelled' : 'done'
export function historyRuns(runs: readonly OrchRunDetail[], filter: HistoryFilter): OrchRunDetail[] {
  const query = filter.query.trim().toLowerCase()
  return runs.filter((r) => {
    if (!isFinishedRun(r) && !r.imported) return false
    if (filter.project && r.projectPath !== filter.project) return false
    if (filter.result && historyResult(r) !== filter.result) return false
    const search = [r.title, r.story, ...r.tasks.map((t) => t.title), ...(r.decisions ?? []).flatMap((d) => [d.question, d.answer, d.context])].join('\n').toLowerCase()
    return !query || search.includes(query)
  }).sort((a, b) => (b.finishedAt ?? b.imported?.at ?? b.createdAt) - (a.finishedAt ?? a.imported?.at ?? a.createdAt) || b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}
