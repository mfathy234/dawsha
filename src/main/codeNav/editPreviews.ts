import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import type { CodeNavEngine } from '../../shared/codeNav'
import type { EditPreviewFile, EditResult, TextEdit } from '../../shared/codeNavExtras'
import { readProjectFile, resolveProjectFile, writeProjectFile } from '../gitWorkspace'

export const validRelative = (path: unknown): path is string => typeof path === 'string' && path.length > 0 && path.length < 4096 && !/[\\:\x00-\x1f]/.test(path) && !path.startsWith('/') && !path.split('/').some(part => part === '..' || part === '.git' || part === '')
interface Preview { folder: string; kind: 'rename' | 'replace'; at: number; files: EditPreviewFile[]; texts: ReadonlyMap<string, string>; originals: ReadonlyMap<string, string> }
const TTL = 5 * 60_000
const MAX_PREVIEWS = 20
const MAX_EDITS = 10_000

export function offsetAt(text: string, line: number, column: number): number {
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1) throw new Error('Invalid edit range.')
  const starts = [...text.matchAll(/\r\n|\r|\n/g)].map(match => match.index! + match[0].length)
  const from = line === 1 ? 0 : starts[line - 2]
  if (from === undefined) throw new Error('Edit line is outside the file.')
  const end = text.slice(from).search(/[\r\n]/)
  const length = end < 0 ? text.length - from : end
  if (column > length + 1) throw new Error('Edit column is outside the line.')
  return from + column - 1
}

function edited(text: string, edits: TextEdit[]): string {
  const ranges = edits.map(edit => ({ from: offsetAt(text, edit.line, edit.column), to: offsetAt(text, edit.endLine, edit.endColumn), text: edit.newText })).sort((a, b) => b.from - a.from || b.to - a.to)
  let previous = text.length + 1
  return ranges.reduce((out, range) => {
    if (range.to < range.from || range.to > previous || typeof range.text !== 'string') throw new Error('Overlapping or invalid edits.')
    previous = range.from
    return out.slice(0, range.from) + range.text + out.slice(range.to)
  }, text)
}

export class EditPreviews {
  private readonly entries = new Map<string, Preview>()

  async create(folder: string, kind: Preview['kind'], files: EditPreviewFile[], originals: ReadonlyMap<string, string>, engine: CodeNavEngine | 'search', truncated = false): Promise<EditResult> {
    try {
      if (files.reduce((sum, file) => sum + file.edits.length, 0) > MAX_EDITS) return { ok: false, error: 'Too many edits. Narrow the request.' }
      const texts = new Map(files.map(file => [file.path, edited(originals.get(file.path)!, file.edits)]))
      const previewId = randomUUID()
      for (const [id, preview] of this.entries) if (Date.now() - preview.at > TTL) this.entries.delete(id)
      while (this.entries.size >= MAX_PREVIEWS) this.entries.delete(this.entries.keys().next().value!)
      this.entries.set(previewId, { folder: await realpath(folder), kind, files: structuredClone(files), texts, originals: new Map(originals), at: Date.now() })
      return { ok: true, action: 'preview', previewId, files, engine, truncated }
    } catch { return { ok: false, error: 'The server returned invalid edit ranges. Refresh and try again.' } }
  }

  async apply(folder: string, raw: Record<string, unknown>, kind: Preview['kind']): Promise<EditResult> {
    if (typeof raw.previewId !== 'string' || !Array.isArray(raw.dirtyPaths) || raw.dirtyPaths.length > 10_000 || !raw.dirtyPaths.every(validRelative)) return { ok: false, error: 'Invalid apply request; include all dirty editor paths.' }
    const preview = this.entries.get(raw.previewId)
    if (!preview || preview.kind !== kind || preview.folder !== await realpath(folder) || Date.now() - preview.at > TTL) return { ok: false, error: 'This preview expired or belongs to another operation. Preview again.' }
    this.entries.delete(raw.previewId)
    const canonical = await Promise.all(raw.dirtyPaths.map(async path => {
      const target = await resolveProjectFile(folder, path)
      return target.ok ? target.realRel : path
    }))
    const dirty = new Set<string>(process.platform === 'win32' ? canonical.map(path => path.toLowerCase()) : canonical)
    const files = []
    for (const file of preview.files) {
      const target = await resolveProjectFile(folder, file.path)
      const identity = target.ok ? target.realRel : file.path
      const key = process.platform === 'win32' ? identity.toLowerCase() : identity
      const read = target.ok ? await readProjectFile(folder, file.path) : target
      if (dirty.has(key) || !read.ok || read.text === null || read.mtimeMs !== file.expectedMtime || read.text !== preview.originals.get(file.path)) {
        files.push({ path: file.path, ok: false, conflict: true, error: dirty.has(key) ? 'This file has unsaved editor changes.' : 'This file changed or was removed after preview.' })
        continue
      }
      const result = await writeProjectFile(folder, file.path, preview.texts.get(file.path)!, file.expectedMtime)
      files.push({ path: file.path, ...result })
    }
    return { ok: true, action: 'apply', files }
  }
}
