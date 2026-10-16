import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { exportRunFile, exportRunFiles, importRunFiles } from '../../src/main/orch/archiveFiles'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'

const dialogs = vi.hoisted(() => ({ save: vi.fn(), open: vi.fn() }))
vi.mock('electron', () => ({ dialog: { showSaveDialog: dialogs.save, showOpenDialog: dialogs.open } }))
let root: string
let store: OrchStore
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'orch-files-'))
  store = new OrchStore(':memory:')
  const svc = new OrchService(store)
  const run = svc.startRun({ kind: 'bug', title: '../Crash', story: 's', projectPath: 'C:/repo', plan: 'default' })
  return { svc, run }
}
afterEach(async () => { store?.close(); if (root) await rm(root, { recursive: true, force: true }); vi.clearAllMocks() })

describe('archive file dialogs', () => {
  it('exports gzip and Markdown only to the chosen path, and imports with per-file failures', async () => {
    const { svc, run } = await setup()
    const path = join(root, 'chosen.dawsharun')
    dialogs.save.mockResolvedValue({ canceled: false, filePath: path })
    expect((await exportRunFile(svc, run.id, 'dawsharun', '1.0')).ok).toBe(true)
    expect(JSON.parse(gunzipSync(await readFile(path)).toString()).run.id).toBe(run.id)
    const bad = join(root, 'bad.dawsharun'); await writeFile(bad, 'not gzip')
    dialogs.open.mockResolvedValue({ canceled: false, filePaths: [bad, path] })
    const imported = await importRunFiles(svc)
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.value.map((r) => r.result.ok)).toEqual([false, true])
    expect(svc.runs()).toHaveLength(2)
    const md = join(root, 'chosen.md')
    dialogs.save.mockResolvedValue({ canceled: false, filePath: md })
    await exportRunFile(svc, run.id, 'markdown', '1.0')
    expect(await readFile(md, 'utf8')).toContain('# ../Crash')
  })

  it('asks once for a folder for multiple exports and keeps duplicate titles separate', async () => {
    const { svc, run } = await setup()
    const other = svc.importRun(svc.exportRun(run.id))
    dialogs.open.mockResolvedValue({ canceled: false, filePaths: [root] })
    const result = await exportRunFiles(svc, [run.id, other.id], '1.0')
    expect(dialogs.open).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.every((r) => r.result.ok)).toBe(true)
    const paths = result.value.map((r) => r.path)
    expect(new Set(paths).size).toBe(2)
    expect(paths.every((p) => p.startsWith(root))).toBe(true)
    expect(dialogs.save).not.toHaveBeenCalled()
  })

  it('rejects decompression bombs, unknown versions and cancelled dialogs without inserts', async () => {
    const { svc, run } = await setup()
    const bomb = join(root, 'bomb.dawsharun')
    await writeFile(bomb, gzipSync(Buffer.alloc(21 * 1024 * 1024, 32)))
    const version = join(root, 'version.dawsharun')
    await writeFile(version, gzipSync(JSON.stringify({ ...svc.exportRun(run.id), version: 2 })))
    dialogs.open.mockResolvedValue({ canceled: false, filePaths: [bomb, version] })
    const result = await importRunFiles(svc)
    expect(result.ok && result.value.every((r) => !r.result.ok)).toBe(true)
    expect(svc.runs()).toHaveLength(1)
    dialogs.save.mockResolvedValue({ canceled: true })
    expect(await exportRunFile(svc, run.id, 'dawsharun', '1.0')).toEqual({ ok: true, value: null })
    dialogs.open.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await importRunFiles(svc)).toEqual({ ok: true, value: [] })
  })
})
