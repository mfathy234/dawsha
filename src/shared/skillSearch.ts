import type { BulkSkillExport, SkillEntry } from './skills'

export interface SkillQuery {
  kind: SkillEntry['kind']
  agent: 'all' | SkillEntry['agent']
  query: string
}

/** Every whitespace-separated term must appear in the name, path, project, agent or scope. */
export function filterSkills(entries: readonly SkillEntry[], { kind, agent, query }: SkillQuery): SkillEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((entry) => {
    if (entry.kind !== kind || (agent !== 'all' && entry.agent !== agent)) return false
    const haystack = [entry.name, entry.path, entry.project ?? '', entry.agent, entry.scope].join('\n').toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

const AGENT_NAMES: Record<SkillEntry['agent'], string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', shared: 'shared' }

export function skillExportLabel(count: number, kind: SkillEntry['kind'], agent: SkillQuery['agent']): string {
  if (count === 0) return `Export ${kind === 'skill' ? 'skills' : 'agents'}`
  const noun = kind === 'skill' ? (count === 1 ? 'skill' : 'skills') : count === 1 ? 'agent' : 'agents'
  return agent === 'all' ? `Export all ${count} ${noun}` : `Export ${count} ${AGENT_NAMES[agent]} ${noun}`
}

export function skillExportSummary(result: BulkSkillExport): string {
  const done = `Exported ${result.exported} to ${result.folder}.`
  if (result.skipped.length === 0) return done
  const first = result.skipped.slice(0, 2).map((s) => `${s.name} (${s.reason})`).join(', ')
  const more = result.skipped.length > 2 ? ` and ${result.skipped.length - 2} more` : ''
  return `${done} Skipped ${result.skipped.length}: ${first}${more}.`
}
