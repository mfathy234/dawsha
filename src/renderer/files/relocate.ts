export interface Spot {
  line: number
  column: number
}

export interface HitSpot extends Spot {
  /** The trimmed text of the hit's line as the engine saw it on disk. */
  preview: string
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function symbolColumn(line: string, symbol: string): number {
  if (symbol === '') return -1
  const found = new RegExp(`(?<![\\w$])${escapeRegex(symbol)}(?![\\w$])`).exec(line)
  return found ? found.index + 1 : -1
}

const indentColumn = (line: string): number => line.length - line.trimStart().length + 1

/** Lines in order of distance from `line`, the line itself first. */
function* nearby(line: number, count: number): Generator<number> {
  for (let distance = 0; distance < count; distance += 1) {
    if (distance === 0) {
      if (line >= 1 && line <= count) yield line
      continue
    }
    if (line - distance >= 1 && line - distance <= count) yield line - distance
    if (line + distance >= 1 && line + distance <= count) yield line + distance
  }
}

/**
 * A hit came from the saved file, but the open buffer has unsaved edits, so its line may have moved. Looks for the
 * hit's own text near the reported line, then for the symbol, and falls back to the reported spot.
 */
export function relocateHit(text: string, hit: HitSpot, symbol: string): Spot {
  const lines = text.split('\n')
  const fallback = { line: Math.min(Math.max(hit.line, 1), lines.length), column: hit.column }
  const wanted = hit.preview.trim()
  if (wanted !== '' && lines[hit.line - 1]?.trim() === wanted) return { line: hit.line, column: hit.column }
  if (wanted !== '') {
    for (const candidate of nearby(hit.line, lines.length)) {
      if (lines[candidate - 1].trim() !== wanted) continue
      const column = symbolColumn(lines[candidate - 1], symbol)
      return { line: candidate, column: column > 0 ? column : indentColumn(lines[candidate - 1]) }
    }
  }
  for (const candidate of nearby(hit.line, lines.length)) {
    const column = symbolColumn(lines[candidate - 1], symbol)
    if (column > 0) return { line: candidate, column }
  }
  return fallback
}
