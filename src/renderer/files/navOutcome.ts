import type { CodeNavEngine, CodeNavHit, CodeNavKind, CodeNavResult, CodeNavStatus } from '../../shared/codeNav'

export type NavPlan =
  | { kind: 'jump'; hit: CodeNavHit; note: string | null }
  | { kind: 'peek'; hits: CodeNavHit[]; note: string | null }
  | { kind: 'message'; text: string; outside: boolean }

const NOUN: Record<CodeNavKind, string> = { definition: 'definition', implementation: 'implementation', references: 'reference' }

export const countLabel = (kind: CodeNavKind, count: number): string => `${count} ${NOUN[kind]}${count === 1 ? '' : 's'}`

/** What a by-name answer says about itself; exact answers carry no label. */
export function byNameNote(count: number): string {
  if (count <= 1) return 'Best match by name'
  return `Best match by name · ${count - 1} other match${count === 2 ? '' : 'es'}`
}

export const notFoundText = (kind: CodeNavKind, symbol: string): string => `No ${kind === 'references' ? 'references' : NOUN[kind]} found for ${symbol}.`

export const outsideText = (symbol: string): string => `${symbol} is defined outside this project.`

export const NO_NAME_TEXT = 'Put the cursor on a name first, then press the key again.'

function peekNote(kind: CodeNavKind, engine: CodeNavEngine, count: number): string {
  if (engine === 'name' && kind !== 'references') return byNameNote(count)
  return countLabel(kind, count)
}

/** Turns an engine answer into what the editor shows. A failed request reads as "not found" so the user is never left guessing. */
export function planNavigation(kind: CodeNavKind, symbol: string, result: CodeNavResult): NavPlan {
  if (!result.ok) return { kind: 'message', text: notFoundText(kind, symbol), outside: false }
  if (result.hits.length === 0) {
    return result.outside
      ? { kind: 'message', text: outsideText(symbol), outside: true }
      : { kind: 'message', text: notFoundText(kind, symbol), outside: false }
  }
  const byName = result.engine === 'name' && kind !== 'references'
  if (result.hits.length === 1 && kind !== 'references') return { kind: 'jump', hit: result.hits[0], note: byName ? byNameNote(1) : null }
  return { kind: 'peek', hits: result.hits, note: peekNote(kind, result.engine, result.hits.length) }
}

export interface EngineLine {
  text: string
  action: 'restart' | 'install' | null
  actionLabel: string
}

const NO_LINE: EngineLine = { text: '', action: null, actionLabel: '' }
const ENGINE_NAME: Record<CodeNavEngine, string> = { typescript: 'TypeScript', csharp: 'C#', name: '' }

/** The status bar text for the language service behind the active file. */
export function engineLine(status: CodeNavStatus | null): EngineLine {
  if (!status || status.state === 'none') return NO_LINE
  const name = ENGINE_NAME[status.engine]
  if (status.state === 'ready') return { text: `${name} ready`, action: null, actionLabel: '' }
  if (status.state === 'starting') return { text: `${name} starting. Results are by name until it is ready.`, action: null, actionLabel: '' }
  if (status.state === 'stopped') return { text: `${name} stopped. Results are by name.`, action: 'restart', actionLabel: 'Restart' }
  if (status.engine === 'csharp') {
    return status.canInstall
      ? { text: 'C# by name', action: 'install', actionLabel: 'Install csharp-ls for exact results' }
      : { text: 'C# by name', action: null, actionLabel: '' }
  }
  return NO_LINE
}

export type { CodeNavHit }
