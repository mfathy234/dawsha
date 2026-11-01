import type { EditPreviewFile, EditResult, TextEdit } from '../shared/codeNavExtras'
import { matcherFor, validateSearchRequest } from '../shared/fileSearch'
import { EditPreviews } from './codeNav/editPreviews'
import { searchFiles } from './filesExtra'
import { MAX_READ_BYTES, readProjectFile } from './gitWorkspace'

/** Replacement uses JavaScript capture substitutions only for regex queries. */
function substitution(template: string, match: RegExpMatchArray, line: string): string {
  const parts: string[] = []
  let bytes = 0
  let from = 0
  const append = (text: string): void => {
    bytes += Buffer.byteLength(text)
    if (bytes > MAX_READ_BYTES) throw new Error('Replacement expansion is too large to save.')
    parts.push(text)
  }
  const expand = (token: string, key: string): string => {
    if (key === '$') return '$'
    if (key === '&') return match[0]
    if (key === '`') return line.slice(0, match.index)
    if (key === "'") return line.slice(match.index! + match[0].length)
    if (key.startsWith('<')) return match.groups ? match.groups[key.slice(1, -1)] ?? '' : token
    const number = Number(key)
    if (number > 0 && number < match.length) return match[number] ?? ''
    const first = Number(key[0])
    return key.length === 2 && first > 0 && first < match.length ? (match[first] ?? '') + key[1] : token
  }
  for (const token of template.matchAll(/\$(\$|&|`|'|<[^>]*>|\d{1,2})/g)) {
    append(template.slice(from, token.index))
    append(expand(token[0], token[1]))
    from = token.index! + token[0].length
  }
  append(template.slice(from))
  return parts.join('')
}

function lineEdits(text: string, pattern: RegExp, replacement: string, regex: boolean, room: number): TextEdit[] {
  const edits: TextEdit[] = []
  let bytes = Buffer.byteLength(text)
  const lines = text.split(/\r\n|\r|\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    for (const match of line.matchAll(new RegExp(pattern.source, pattern.flags))) {
      if (edits.length >= room) throw new Error('Too many replacement matches. Narrow the search.')
      const newText = regex ? substitution(replacement, match, line) : replacement
      bytes += Buffer.byteLength(newText) - Buffer.byteLength(match[0])
      if (bytes > MAX_READ_BYTES) throw new Error('Replacement output is too large to save.')
      edits.push({ line: index + 1, column: match.index! + 1, endLine: index + 1, endColumn: match.index! + match[0].length + 1, newText })
    }
  }
  return edits
}

export async function replaceInFiles(folder: string, raw: unknown, previews: EditPreviews): Promise<EditResult> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid replace request.' }
  const value = raw as Record<string, unknown>
  if (value.action === 'apply') return previews.apply(folder, value, 'replace')
  const checked = validateSearchRequest(value)
  if (!checked.ok) return checked
  if (value.action !== 'preview' || typeof value.replacement !== 'string' || Buffer.byteLength(value.replacement) > MAX_READ_BYTES) return { ok: false, error: 'Invalid replacement.' }
  const found = await searchFiles(folder, checked.request)
  if (!found.ok) return found
  const files: EditPreviewFile[] = []
  const originals = new Map<string, string>()
  let remaining = 10_000
  let totalBytes = 0
  for (const file of found.files) {
    const read = await readProjectFile(folder, file.path)
    if (!read.ok || read.text === null) return { ok: false, error: `Could not preview ${file.path}. Search again.` }
    let edits: TextEdit[]
    try { edits = lineEdits(read.text, matcherFor(checked.request)!, value.replacement, checked.request.regex, remaining) }
    catch (error) { return { ok: false, error: (error as Error).message } }
    remaining -= edits.length
    totalBytes += Buffer.byteLength(read.text) + edits.reduce((sum, edit) => sum + Buffer.byteLength(edit.newText), 0)
    if (totalBytes > 16 * MAX_READ_BYTES) return { ok: false, error: 'Replacement preview exceeds its byte budget. Narrow the search.' }
    if (edits.length === 0) continue
    files.push({ path: file.path, expectedMtime: read.mtimeMs, edits, matches: edits.length })
    originals.set(file.path, read.text)
  }
  return previews.create(folder, 'replace', files, originals, 'search', found.truncated)
}
