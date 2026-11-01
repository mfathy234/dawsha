import type { CodeNavHit } from '../../shared/codeNav'

export interface AskModel {
  /** Project-relative, as the agent sees the path from its folder. */
  path: string
  startLine: number
  endLine: number
  symbol: string | null
  selection: string
  references: readonly CodeNavHit[]
  /** The references came from a text search, not a language service. */
  referencesByName: boolean
}

const MAX_SELECTION = 1200
const MAX_REFERENCES = 8
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

const range = (model: AskModel): string => (model.endLine > model.startLine ? `#L${model.startLine}-${model.endLine}` : `#L${model.startLine}`)

/** The message put into an agent's prompt: where the code is, the code itself, and where it is used. The question is left for the user to type. */
export function askMessage(model: AskModel): string {
  const lines = [`About @${model.path}${range(model)}${model.symbol ? ` (${model.symbol})` : ''}:`]
  const code = model.selection.trim() === '' ? '' : model.selection.length > MAX_SELECTION ? `${model.selection.slice(0, MAX_SELECTION)}\n…` : model.selection
  if (code) lines.push('', '```', code.replace(/\s+$/, ''), '```')
  const shown = model.references.slice(0, MAX_REFERENCES)
  if (shown.length > 0) {
    const more = model.references.length - shown.length
    lines.push('', model.referencesByName ? 'Used here, best guesses found by name:' : 'Used here:')
    for (const hit of shown) lines.push(`- ${hit.path}:${hit.line}  ${oneLine(hit.preview)}`)
    if (more > 0) lines.push(`- and ${more} more`)
  }
  lines.push('', '')
  return lines.join('\n')
}
