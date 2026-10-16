import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { gzip, gunzip } from 'node:zlib'
import { dialog } from 'electron'
import type { OrchArchiveFileResult, OrchExportFormat, OrchResult } from '../../shared/orch/api'
import { ARCHIVE_MAX_BYTES, archiveToMarkdown, parseArchive } from '../../shared/orch/runArchive'
import type { OrchService } from './service'

const compress = promisify(gzip)
const decompress = promisify(gunzip)
type Log = (message: string) => void
const ignore: Log = () => undefined
const slug = (s: string): string => s.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'run'

function fileName(service: OrchService, id: string, format: OrchExportFormat): string {
  const run = service.run(id)
  if (!run) throw new Error('That run no longer exists.')
  const project = run.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? 'project'
  return `${slug(project)}-${slug(run.title)}-${new Date().toISOString().slice(0, 10)}.${format === 'markdown' ? 'md' : 'dawsharun'}`
}

async function writeArchive(service: OrchService, id: string, format: OrchExportFormat, version: string, path: string, exclusive = false): Promise<void> {
  const archive = service.exportRun(id, version)
  // Exports must remain readable by our bounded importer.
  const json = JSON.stringify(archive)
  const checked = parseArchive(json)
  if (!checked.ok) throw new Error(checked.error)
  const data = format === 'markdown' ? archiveToMarkdown(archive) : await compress(json)
  await writeFile(path, data, { flag: exclusive ? 'wx' : 'w' })
}

export async function exportRunFile(service: OrchService, id: string, format: OrchExportFormat, version: string, log: Log = ignore): Promise<OrchResult<string | null>> {
  try {
    const name = fileName(service, id, format)
    const override = process.env.DAWSHA_SAVE_PATH
    const choice = override ? { canceled: false, filePath: override } : await dialog.showSaveDialog({
      title: 'Export run', defaultPath: name,
      filters: [{ name: format === 'markdown' ? 'Markdown report' : 'Dawsha run', extensions: [format === 'markdown' ? 'md' : 'dawsharun'] }]
    })
    if (choice.canceled || !choice.filePath) return { ok: true, value: null }
    await writeArchive(service, id, format, version, choice.filePath)
    return { ok: true, value: choice.filePath }
  } catch (error) {
    log(`orchestrator export failed: ${String(error)}`)
    return { ok: false, error: 'Could not export the run. Check the selected path and available space.' }
  }
}

/** The batch endpoint keeps folder paths in main; the renderer can only pass run IDs. */
export async function exportRunFiles(service: OrchService, ids: string[], version: string, log: Log = ignore): Promise<OrchResult<OrchArchiveFileResult[]>> {
  try {
    if (ids.length === 1) {
      const result = await exportRunFile(service, ids[0], 'dawsharun', version, log)
      if (!result.ok) return result
      return { ok: true, value: result.value ? [{ path: result.value, result: { ok: true, value: ids[0] } }] : [] }
    }
    const override = process.env.DAWSHA_EXPORT_FOLDER
    const choice = override ? { canceled: false, filePaths: [override] } : await dialog.showOpenDialog({ title: 'Export runs to folder', properties: ['openDirectory'] })
    if (choice.canceled || !choice.filePaths[0]) return { ok: true, value: [] }
    const results: OrchArchiveFileResult[] = []
    const used = new Set<string>()
    for (const id of ids) {
      let path = ''
      try {
        const name = fileName(service, id, 'dawsharun')
        let candidate = name
        let suffix = 1
        while (used.has(candidate)) candidate = name.replace(/\.dawsharun$/, `-${++suffix}.dawsharun`)
        used.add(candidate)
        path = join(choice.filePaths[0], candidate)
        await writeArchive(service, id, 'dawsharun', version, path, true)
        results.push({ path, result: { ok: true, value: id } })
      } catch (error) {
        log(`orchestrator batch export failed: ${String(error)}`)
        results.push({ path, result: { ok: false, error: 'Could not export this run; the file may already exist.' } })
      }
    }
    return { ok: true, value: results }
  } catch (error) {
    log(`orchestrator export dialog failed: ${String(error)}`)
    return { ok: false, error: 'Could not choose an export folder.' }
  }
}

export async function importRunFiles(service: OrchService, log: Log = ignore): Promise<OrchResult<OrchArchiveFileResult[]>> {
  try {
    const override = process.env.DAWSHA_OPEN_PATHS
    const choice = override ? { canceled: false, filePaths: JSON.parse(override) as string[] } : await dialog.showOpenDialog({
      title: 'Import runs', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Dawsha run', extensions: ['dawsharun'] }]
    })
    if (choice.canceled) return { ok: true, value: [] }
    if (!Array.isArray(choice.filePaths) || choice.filePaths.length > 100 || !choice.filePaths.every((p) => typeof p === 'string')) throw new Error('Invalid file selection')
    const results: OrchArchiveFileResult[] = []
    for (const path of choice.filePaths) {
      try {
        const info = await stat(path)
        if (!info.isFile() || info.size > ARCHIVE_MAX_BYTES) throw new Error('Archive exceeds the 20 MB limit or is not a file.')
        const bytes = await readFile(path)
        if (bytes.length > ARCHIVE_MAX_BYTES) throw new Error('Archive exceeds the 20 MB limit.')
        const json = await decompress(bytes, { maxOutputLength: ARCHIVE_MAX_BYTES })
        const parsed = parseArchive(json.toString('utf8'))
        if (!parsed.ok) { results.push({ path, result: { ok: false, error: parsed.error } }); continue }
        const run = service.importRun(parsed.archive, basename(path))
        results.push({ path, result: { ok: true, value: run.id } })
      } catch (error) {
        log(`orchestrator import failed for ${path}: ${String(error)}`)
        results.push({ path, result: { ok: false, error: 'Could not read this run. Use a valid gzip .dawsharun file under 20 MB (including decompressed content).' } })
      }
    }
    return { ok: true, value: results }
  } catch (error) {
    log(`orchestrator import dialog failed: ${String(error)}`)
    return { ok: false, error: 'Could not open the selected run files.' }
  }
}
