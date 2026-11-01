import type { CodeNavHit, CodeNavRequest, CodeNavResult } from '../../shared/codeNav'
import { searchFiles } from '../filesExtra'
import { readProjectFile } from '../gitWorkspace'

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const declaration = (text: string, symbol: string): boolean => new RegExp(`\\b(class|interface|struct|record|enum|type|function|const|let|var|def)\\s+${escape(symbol)}\\b|\\b${escape(symbol)}\\s*(?:\\([^;]*\\)\\s*(?:[:{]|=>)|[{:])`).test(text)

function implementation(text: string, symbol: string, prefix: string): boolean {
  const name = escape(symbol)
  if (/\b(class|struct|record|interface)\s+[^{};]*(?::|\bimplements\b|\bextends\b)[^{};]*$/.test(prefix)) return true
  if (/\b(class|struct|record|interface)\s+/.test(text)) return false
  return new RegExp(`(?:^|\\s)(?:[\\w<>[\\],?]+\\s+)+${name}\\s*(?:\\(|\\{|=>)|^\\s*${name}\\s*\\([^;]*\\)\\s*(?:\\{|:|=>)`).test(text)
}

function hitsIn(path: string, lines: string[], request: CodeNavRequest, candidates = lines.map((_line, index) => index)): CodeNavHit[] {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_$])${escape(request.symbol)}(?![\\p{L}\\p{N}_$])`, 'u')
  return candidates.flatMap(index => {
    const text = lines[index] ?? ''
    const match = pattern.exec(text)
    if (!match) return []
    const prefix = lines.slice(Math.max(0, index - 10), index).join('\n') + '\n' + text.slice(0, match.index)
    if (request.kind === 'implementation' && !implementation(text, request.symbol, prefix)) return []
    return [{ path, line: index + 1, column: match.index + 1, preview: text.trim() }]
  })
}

export async function nameSearch(folder: string, request: CodeNavRequest): Promise<CodeNavResult> {
  const result = await searchFiles(folder, { query: request.symbol, matchCase: true, wholeWord: false, regex: false, include: '' })
  if (!result.ok) return result
  const hits: CodeNavHit[] = []
  for (const file of result.files) {
    if (file.path === request.path && request.unsavedText !== undefined) continue
    const read = await readProjectFile(folder, file.path)
    if (!read.ok || read.text === null) continue
    const lines = read.text.split(/\r\n|\r|\n/)
    hits.push(...hitsIn(file.path, lines, request, file.matches.map(match => match.line - 1)))
  }
  if (request.unsavedText !== undefined) {
    const lines = request.unsavedText.split(/\r\n|\r|\n/)
    hits.push(...hitsIn(request.path, lines, request))
  }
  const ranked = request.kind === 'definition' ? [...hits].sort((a, b) => Number(declaration(b.preview, request.symbol)) - Number(declaration(a.preview, request.symbol))) : hits
  return { ok: true, hits: ranked.slice(0, 500), engine: 'name', outside: false }
}
