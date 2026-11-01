import { relative } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { CallHierarchyItem, CallHierarchyResult, EditPreviewFile, EditResult, HoverResult } from '../../shared/codeNavExtras'
import { repoRoot } from '../gitCommit'
import { readProjectFile, resolveProjectFile } from '../gitWorkspace'
import { EditPreviews, validRelative } from './editPreviews'
import { navigationHits } from './locations'
import { nameSearch } from './nameSearch'
import type { CodeNavRouter } from './router'
import type { ServerFileEdits } from './protocolExtras'
import { renameSnapshot, validRename } from './renameSnapshot'

const needsServer = { ok: false as const, needsLanguageServer: true, error: 'Rename needs a ready language server. Start or install the language server, then try again.' }
const message = (error: unknown): string => error instanceof Error ? error.message : 'The language server could not answer.'

export class CodeNavExtras {
  constructor(private readonly router: CodeNavRouter, private readonly previews: EditPreviews) {}

  async hover(folder: string, raw: unknown): Promise<HoverResult> {
    const context = await this.router.context(folder, raw)
    if ('error' in context) return { ok: false, error: context.error }
    const { server, file, text, request, engine } = context
    if (server?.hover) {
      try { return { ok: true, engine, ...await server.hover(file, text, request) } } catch { /* Use a declaration line when exact hover is unavailable. */ }
    }
    const found = await nameSearch(folder, { ...request, kind: 'definition' })
    if (!found.ok) return found
    const declaration = found.hits[0]
    return { ok: true, engine: 'name', display: declaration?.preview ?? '', documentation: '', ...(declaration ? { declaration } : {}) }
  }

  async renameSymbol(folder: string, raw: unknown): Promise<EditResult> {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid rename request.' }
    const value = raw as Record<string, unknown>
    if (value.action === 'apply') return this.previews.apply(folder, value, 'rename')
    if (value.action !== 'preview' || typeof value.newName !== 'string' || !/^@?[$_\p{L}][$_\p{L}\p{N}]*$/u.test(value.newName) || value.newName.length > 200) return { ok: false, error: 'Enter a valid new symbol name.' }
    const context = await this.router.context(folder, value)
    if ('error' in context) return { ok: false, error: context.error }
    if (context.request.unsavedText !== undefined && context.request.unsavedText !== (await readProjectFile(folder, context.request.path) as { text?: string }).text) return { ok: false, error: 'Save this editor buffer before previewing rename.' }
    if (!validRename(value.newName, context.engine)) return { ok: false, error: 'Enter a valid identifier for this language.' }
    if (!context.server?.rename) return needsServer
    try {
      const snapshot = await renameSnapshot(folder)
      const source = await resolveProjectFile(folder, context.request.path)
      if (!source.ok || snapshot.get(source.realRel) !== context.mtimeMs) throw new Error('Files changed during rename. Preview again.')
      const edits = await context.server.rename(context.file, context.text, context.request, value.newName)
      return await this.renamePreview(folder, edits, context.engine, snapshot)
    } catch (error) { return { ok: false, error: message(error) } }
  }

  private async renamePreview(folder: string, groups: ServerFileEdits[], engine: 'typescript' | 'csharp' | 'name', snapshot: ReadonlyMap<string, number>): Promise<EditResult> {
    const root = await realpath(await repoRoot(folder) ?? folder)
    const files: EditPreviewFile[] = []
    const originals = new Map<string, string>()
    for (const group of groups) {
      const path = relative(root, group.file).replace(/\\/g, '/')
      if (!validRelative(path)) return { ok: false, error: 'Rename includes files outside the project; no files were changed.' }
      const target = await resolveProjectFile(folder, path)
      if (!target.ok) return { ok: false, error: 'Rename includes unavailable files; no files were changed.' }
      const read = await readProjectFile(folder, target.realRel)
      if (!read.ok || read.text === null) return { ok: false, error: `Cannot read ${path} for rename.` }
      if (snapshot.get(target.realRel) !== read.mtimeMs || originals.has(target.realRel)) return { ok: false, error: 'Files changed during rename. Preview again.' }
      files.push({ path: target.realRel, expectedMtime: read.mtimeMs, edits: group.edits, matches: group.edits.length })
      originals.set(target.realRel, read.text)
    }
    return this.previews.create(folder, 'rename', files, originals, engine)
  }

  async callHierarchy(folder: string, raw: unknown): Promise<CallHierarchyResult> {
    const value = raw as Record<string, unknown> | null
    if (!value || !['incoming', 'outgoing'].includes(String(value.direction))) return { ok: false, error: 'Invalid call hierarchy direction.' }
    const context = await this.router.context(folder, raw)
    if ('error' in context) return { ok: false, error: context.error }
    if (!context.server?.calls) return { ok: true, engine: 'name', items: [], outside: false }
    try {
      const calls = await context.server.calls(context.file, context.text, context.request, value.direction as 'incoming' | 'outgoing')
      const items: CallHierarchyItem[] = []
      let outside = false
      for (const call of calls.slice(0, 500)) {
        const symbol = await navigationHits(folder, [call.symbol], context.engine)
        const sites = await navigationHits(folder, call.calls, context.engine)
        if (!symbol.ok || !sites.ok) continue
        outside ||= symbol.outside || sites.outside
        if (symbol.hits[0]) items.push({ name: call.name, symbol: symbol.hits[0], calls: sites.hits })
      }
      return { ok: true, engine: context.engine, items, outside }
    } catch (error) { return { ok: false, error: message(error) } }
  }
}
