import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditPreviews } from '../../src/main/codeNav/editPreviews'
import { writeProjectFile } from '../../src/main/gitWorkspace'

const failures = vi.hoisted(() => ({ writes: new Map<string, number[]>(), short: new Map<string, number[]>(), zero: new Map<string, number[]>(), counts: new Map<string, number>() }))
// Keep real resolution, reads and handles; fail only the OS write boundary.
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    const handle = await fs.open(...args)
    const path = String(args[0])
    return new Proxy(handle, { get(target, key) {
      if (key === 'write') return async (...writeArgs: unknown[]) => {
        const count = (failures.counts.get(path) ?? 0) + 1
        failures.counts.set(path, count)
        if (failures.zero.get(basename(path))?.includes(count)) return { bytesWritten: 0, buffer: writeArgs[0] }
        if (failures.short.get(basename(path))?.includes(count)) {
          if (typeof writeArgs[0] === 'string') return target.write(writeArgs[0].slice(0, 1), 0, 'utf8')
          return target.write(writeArgs[0] as Uint8Array, Number(writeArgs[1]), 1, Number(writeArgs[3]))
        }
        if (failures.writes.get(basename(path))?.includes(count)) {
          await target.write('partial', 0, 'utf8')
          throw new Error('injected disk failure')
        }
        return Reflect.apply(target.write, target, writeArgs)
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  } }
})

const roots: string[] = []
afterEach(() => {
  failures.writes.clear()
  failures.short.clear()
  failures.zero.clear()
  failures.counts.clear()
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-edit-previews-'))
  roots.push(root)
  for (const path of ['a.ts', 'b.ts', 'c.ts']) writeFileSync(join(root, path), 'greet\n')
  return root
}
async function preview(root: string, kind: 'rename' | 'replace', originals = new Map(['a.ts', 'b.ts', 'c.ts'].map(path => [path, 'greet\n'])), staleMtime = false) {
  const previews = new EditPreviews()
  const result = await previews.create(root, kind, [...originals].map(([path]) => ({ path, expectedMtime: statSync(join(root, path)).mtimeMs + (staleMtime && path === 'b.ts' ? 1 : 0), matches: 1, edits: [{ line: 1, column: 1, endLine: 1, endColumn: 6, newText: 'welcome' }] })), originals, 'search')
  if (!result.ok || result.action !== 'preview') throw new Error('No preview')
  return { previews, previewId: result.previewId }
}

describe.each(['rename', 'replace'] as const)('%s apply transaction', kind => {
  it('finishes short successful writes without losing any bytes', async () => {
    const root = fixture()
    const { previews, previewId } = await preview(root, kind)
    failures.short.set('a.ts', [1, 2])
    const result = await previews.apply(root, { previewId, dirtyPaths: [] }, kind)
    expect(result).toMatchObject({ ok: true, files: [{ ok: true }, { ok: true }, { ok: true }] })
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('welcome\n')
  })

  it('finishes short rollback writes before reporting restoration', async () => {
    const root = fixture()
    const { previews, previewId } = await preview(root, kind)
    failures.short.set('a.ts', [2, 3])
    failures.writes.set('b.ts', [1])
    const result = await previews.apply(root, { previewId, dirtyPaths: [] }, kind)
    expect(result).toMatchObject({ ok: true, files: [{ ok: false, error: expect.stringContaining('rolled back') }, { ok: false }, { ok: false }] })
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('greet\n')
  })

  it('treats a zero-progress write as a failure and restores the original', async () => {
    const root = fixture()
    const { previews, previewId } = await preview(root, kind)
    failures.zero.set('a.ts', [1])
    const result = await previews.apply(root, { previewId, dirtyPaths: [] }, kind)
    expect(result).toMatchObject({ ok: true, files: [{ ok: false, error: expect.stringMatching(/restored/i) }, { ok: false }, { ok: false }] })
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('greet\n')
    expect(readFileSync(join(root, 'b.ts'), 'utf8')).toBe('greet\n')
  })

  it('reports zero-progress writes during rollback', async () => {
    const root = fixture()
    const { previews, previewId } = await preview(root, kind)
    failures.zero.set('a.ts', [2])
    failures.writes.set('b.ts', [1])
    const result = await previews.apply(root, { previewId, dirtyPaths: [] }, kind)
    expect(result).toMatchObject({ ok: true, files: [{ ok: false, error: expect.stringMatching(/rollback failed/i) }, { ok: false }, { ok: false }] })
  })

  it.each(['dirty', 'mtime', 'text'] as const)('writes no files when a later target has a %s conflict', async reason => {
    const root = fixture()
    const originals = new Map(['a.ts', 'b.ts', 'c.ts'].map(path => [path, 'greet\n']))
    if (reason === 'text') writeFileSync(join(root, 'b.ts'), 'other\n')
    const { previews, previewId } = await preview(root, kind, originals, reason === 'mtime')
    const result = await previews.apply(root, { previewId, dirtyPaths: reason === 'dirty' ? ['b.ts'] : [] }, kind)
    expect(result).toMatchObject({ ok: true, action: 'apply', files: expect.arrayContaining([expect.objectContaining({ path: 'b.ts', ok: false, conflict: true })]) })
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('greet\n')
    expect(readFileSync(join(root, 'b.ts'), 'utf8')).toBe(reason === 'text' ? 'other\n' : 'greet\n')
    expect(readFileSync(join(root, 'c.ts'), 'utf8')).toBe('greet\n')
  })

  it('restores earlier files and a partially written failed file, then stops', async () => {
    const root = fixture()
    const { previews, previewId } = await preview(root, kind)
    failures.writes.set('b.ts', [1])
    const result = await previews.apply(root, { previewId, dirtyPaths: [] }, kind)
    expect(result).toMatchObject({ ok: true, files: [
      { path: 'a.ts', ok: false, error: expect.stringMatching(/rolled back|restored/i) },
      { path: 'b.ts', ok: false, error: expect.stringContaining('injected disk failure') },
      { path: 'c.ts', ok: false }
    ] })
    for (const path of ['a.ts', 'b.ts', 'c.ts']) expect(readFileSync(join(root, path), 'utf8')).toBe('greet\n')
  })

  it('reports a rollback failure for the file that could not be restored', async () => {
    const root = fixture()
    const { previews, previewId } = await preview(root, kind)
    failures.writes.set('a.ts', [2])
    failures.writes.set('b.ts', [1])
    const result = await previews.apply(root, { previewId, dirtyPaths: [] }, kind)
    expect(result).toMatchObject({ ok: true, files: expect.arrayContaining([
      expect.objectContaining({ path: 'a.ts', ok: false, error: expect.stringMatching(/rollback failed.*injected disk failure/i) }),
      expect.objectContaining({ path: 'b.ts', ok: false })
    ]) })
    expect(readFileSync(join(root, 'c.ts'), 'utf8')).toBe('greet\n')
  })

  it('reports when restoring the partially written failed target also fails', async () => {
    const root = fixture()
    const { previews, previewId } = await preview(root, kind)
    failures.writes.set('b.ts', [1, 2])
    const result = await previews.apply(root, { previewId, dirtyPaths: [] }, kind)
    expect(result).toMatchObject({ ok: true, files: expect.arrayContaining([
      expect.objectContaining({ path: 'b.ts', ok: false, error: expect.stringMatching(/rollback failed.*injected disk failure/i) })
    ]) })
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('greet\n')
    expect(readFileSync(join(root, 'b.ts'), 'utf8')).toBe('partial')
    expect(readFileSync(join(root, 'c.ts'), 'utf8')).toBe('greet\n')
  })

  it('writes exactly the previewed text while normal saves still use editorconfig', async () => {
    const root = fixture()
    writeFileSync(join(root, '.editorconfig'), 'root = true\n[*]\nend_of_line = crlf\ntrim_trailing_whitespace = true\ninsert_final_newline = true\n')
    const original = '\ufeffgreet  \r\nuntouched  \nlast'
    writeFileSync(join(root, 'a.ts'), original)
    const previews = new EditPreviews()
    const result = await previews.create(root, kind, [{ path: 'a.ts', expectedMtime: statSync(join(root, 'a.ts')).mtimeMs, matches: 1, edits: [{ line: 1, column: 2, endLine: 1, endColumn: 7, newText: 'welcome' }] }], new Map([['a.ts', original]]), 'search')
    if (!result.ok || result.action !== 'preview') throw new Error('No preview')
    expect(await previews.apply(root, { previewId: result.previewId, dirtyPaths: [] }, kind)).toMatchObject({ ok: true, files: [{ ok: true }] })
    expect(readFileSync(join(root, 'a.ts'))).toEqual(Buffer.from('\ufeffwelcome  \r\nuntouched  \nlast'))
    expect(await writeProjectFile(root, 'a.ts', 'normal  \nlast', statSync(join(root, 'a.ts')).mtimeMs)).toMatchObject({ ok: true })
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('normal\r\nlast\r\n')
  })
})
