import type { StaleCaller, StaleCallersResult } from '../../shared/codeNavExtras'
import type { CodeNavHit } from '../../shared/codeNav'

export interface StaleRow {
  id: string
  /** The changed symbol these belong to. */
  group: string
  kind: 'caller' | 'implementation'
  hit: CodeNavHit
}

const shortName = (preview: string): string => preview.replace(/\s+/g, ' ').trim().slice(0, 60) || 'changed symbol'

/** Callers and implementations the agent did not touch. Name searches say so in the group heading. */
export function staleRows(symbols: readonly StaleCaller[]): StaleRow[] {
  return symbols.flatMap((entry) => {
    const group = `${shortName(entry.symbol.preview)}${entry.engine === 'name' ? ' (best guesses by name)' : ''}`
    const one = (kind: StaleRow['kind'], hit: CodeNavHit): StaleRow => ({ id: `${entry.symbol.path}:${entry.symbol.line}:${kind}:${hit.path}:${hit.line}`, group, kind, hit })
    return [...entry.references.map((hit) => one('caller', hit)), ...entry.implementations.map((hit) => one('implementation', hit))]
  })
}

/** Why the list may be short, in plain words; empty when the scan finished. */
export function staleNote(result: Extract<StaleCallersResult, { ok: true }>): string {
  if (!result.stoppedEarly) return ''
  return result.reason === 'timeout'
    ? `Stopped after ${result.scannedSymbols} changed symbols because it took too long. There may be more.`
    : `Looked at the first ${result.scannedSymbols} changed symbols. There may be more.`
}
