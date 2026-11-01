import { execFileSync, fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodeNavRouter } from '../../src/main/codeNav/router'
import { TsServerClient } from '../../src/main/codeNav/tsserver'
import { nodeIpcWire } from '../../src/main/codeNav/transport'
import { CodeNavExtras } from '../../src/main/codeNav/extras'
import { EditPreviews } from '../../src/main/codeNav/editPreviews'
import { replaceInFiles } from '../../src/main/replaceInFiles'
import { staleCallers } from '../../src/main/codeNav/staleCallers'

const require = createRequire(import.meta.url)
const roots: string[] = []
const clients: TsServerClient[] = []
const exits: Promise<unknown>[] = []
afterEach(async () => {
  clients.splice(0).forEach(client => client.stop())
  await Promise.all(exits.splice(0))
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-extras-'))
  roots.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true })
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root, windowsHide: true })
  writeFileSync(join(root, 'a.ts'), '/** Greets a person. */\nexport function greet(name: string) { return name; }\nexport function caller() { return greet("Ada"); }\n')
  writeFileSync(join(root, 'b.ts'), 'import { greet } from "./a";\nexport const result = greet("Bob");\n')
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ files: ['a.ts', 'b.ts'] }))
  return root
}
async function service(root: string): Promise<CodeNavExtras> {
  const options = { cwd: root, silent: true, windowsHide: true }
  const child = fork(require.resolve('typescript/lib/tsserver.js'), ['--useNodeIpc', '--disableAutomaticTypingAcquisition'], options)
  exits.push(once(child, 'exit'))
  const client = new TsServerClient(nodeIpcWire(child), 10_000)
  clients.push(client)
  await client.ready
  return new CodeNavExtras(new CodeNavRouter({ typescript: () => client, csharp: async () => null, canInstall: async () => false }), new EditPreviews())
}
const symbol = { path: 'a.ts', symbol: 'greet', line: 2, column: 19 }

describe('exact code extras', () => {
  it('returns real TypeScript type information and documentation', async () => {
    const root = fixture()
    const extras = await service(root)
    expect(await extras.hover(root, symbol)).toMatchObject({ ok: true, engine: 'typescript', display: expect.stringContaining('greet(name: string)'), documentation: 'Greets a person.' })
  })
  it('previews and applies a real cross-file rename with mtime and dirty-buffer refusal', async () => {
    const root = fixture()
    const extras = await service(root)
    const preview = await extras.renameSymbol(root, { ...symbol, action: 'preview', newName: 'welcome' })
    expect(preview).toMatchObject({ ok: true, action: 'preview', engine: 'typescript', files: expect.arrayContaining([expect.objectContaining({ path: 'a.ts', matches: 2 }), expect.objectContaining({ path: 'b.ts', matches: 2 })]) })
    if (!preview.ok || preview.action !== 'preview') throw new Error('No preview')
    writeFileSync(join(root, 'b.ts'), '// agent edit\n')
    const applied = await extras.renameSymbol(root, { action: 'apply', previewId: preview.previewId, dirtyPaths: ['a.ts'] })
    expect(applied).toMatchObject({ ok: true, action: 'apply', files: [expect.objectContaining({ path: 'a.ts', ok: false, conflict: true }), expect.objectContaining({ path: 'b.ts', ok: false, conflict: true })] })
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toContain('function greet')
    expect(readFileSync(join(root, 'b.ts'), 'utf8')).toBe('// agent edit\n')
  })
  it('writes all clean rename targets and consumes its preview', async () => {
    const root = fixture()
    const extras = await service(root)
    const preview = await extras.renameSymbol(root, { ...symbol, action: 'preview', newName: 'welcome' })
    if (!preview.ok || preview.action !== 'preview') throw new Error('No preview')
    expect(await extras.renameSymbol(root, { action: 'apply', previewId: preview.previewId, dirtyPaths: [] })).toMatchObject({ ok: true, files: [expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })] })
    expect(readFileSync(join(root, 'b.ts'), 'utf8')).toContain('welcome("Bob")')
    expect(await extras.renameSymbol(root, { action: 'apply', previewId: preview.previewId, dirtyPaths: [] })).toMatchObject({ ok: false })
  })
  it('returns incoming and outgoing calls with real TypeScript', async () => {
    const root = fixture()
    const extras = await service(root)
    expect(await extras.callHierarchy(root, { ...symbol, direction: 'incoming' })).toMatchObject({ ok: true, engine: 'typescript', items: expect.arrayContaining([expect.objectContaining({ name: 'caller', calls: [expect.objectContaining({ path: 'a.ts', line: 3 })] })]) })
    expect(await extras.callHierarchy(root, { ...symbol, symbol: 'caller', line: 3, column: 19, direction: 'outgoing' })).toMatchObject({ ok: true, items: [expect.objectContaining({ name: 'greet', symbol: expect.objectContaining({ line: 2 }), calls: [expect.objectContaining({ line: 3 })] })] })
  })
  it('returns exact untouched callers of a working-tree change with real TypeScript', async () => {
    const root = fixture()
    execFileSync('git', ['add', 'a.ts', 'b.ts', 'tsconfig.json'], { cwd: root, windowsHide: true })
    execFileSync('git', ['-c', 'user.name=Tests', '-c', 'user.email=tests@example.test', 'commit', '-qm', 'initial'], { cwd: root, windowsHide: true })
    writeFileSync(join(root, 'a.ts'), readFileSync(join(root, 'a.ts'), 'utf8').replace('return name;', 'return name.toUpperCase();'))
    await service(root)
    const navigation = new CodeNavRouter({ typescript: () => clients[clients.length - 1], csharp: async () => null, canInstall: async () => false })
    expect(await staleCallers(root, navigation)).toMatchObject({ ok: true, symbols: [expect.objectContaining({ engine: 'typescript', references: expect.arrayContaining([expect.objectContaining({ path: 'b.ts', line: 2 })]) })] })
  })
  it('returns a declaration line by name and refuses guessed rename and calls', async () => {
    const root = fixture()
    writeFileSync(join(root, 'a.py'), 'greet("Ada")\ndef greet(name):\n  return name\n')
    const extras = await service(root)
    const request = { ...symbol, path: 'a.py', line: 1, column: 1 }
    expect(await extras.hover(root, request)).toMatchObject({ ok: true, engine: 'name', display: 'def greet(name):', declaration: { path: 'a.py', line: 2 } })
    expect(await extras.renameSymbol(root, { ...request, action: 'preview', newName: 'welcome' })).toMatchObject({ ok: false, needsLanguageServer: true })
    expect(await extras.callHierarchy(root, { ...request, direction: 'incoming' })).toMatchObject({ ok: true, engine: 'name', items: [] })
    expect(await extras.hover(root, { ...request, path: '../secret' })).toMatchObject({ ok: false })
  })
  it('does not present a usage as declaration information when name search has no declaration', async () => {
    const root = fixture()
    writeFileSync(join(root, 'usage.py'), 'unresolved()\n')
    const extras = await service(root)
    expect(await extras.hover(root, { path: 'usage.py', symbol: 'unresolved', line: 1, column: 1 })).toMatchObject({ ok: true, engine: 'name', display: '', documentation: '' })
  })
  it('refuses stale rename ranges when an agent writes while the server is answering', async () => {
    const root = fixture()
    const server = { state: 'ready' as const, ready: Promise.resolve(), stop() {}, query: async () => [], rename: async () => {
      writeFileSync(join(root, 'b.ts'), '// inserted while rename was computing\nimport { greet } from "./a";\n')
      return [{ file: join(root, 'b.ts'), edits: [{ line: 1, column: 10, endLine: 1, endColumn: 15, newText: 'welcome' }] }]
    } }
    const extras = new CodeNavExtras(new CodeNavRouter({ typescript: () => server, csharp: async () => null, canInstall: async () => false }), new EditPreviews())
    expect(await extras.renameSymbol(root, { ...symbol, action: 'preview', newName: 'welcome' })).toMatchObject({ ok: false, error: expect.stringMatching(/changed.*rename/i) })
  })
  it('refuses TypeScript keywords and C# escaped names in TypeScript files', async () => {
    const root = fixture()
    const extras = await service(root)
    for (const newName of ['class', '@welcome']) expect(await extras.renameSymbol(root, { ...symbol, action: 'preview', newName })).toMatchObject({ ok: false })
  })
  it('refuses a dirty editor opened through an in-project junction alias', async () => {
    const root = fixture()
    mkdirSync(join(root, 'real'))
    writeFileSync(join(root, 'real/item.ts'), 'greet\n')
    symlinkSync(join(root, 'real'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    const previews = new EditPreviews()
    const preview = await previews.create(root, 'rename', [{ path: 'real/item.ts', expectedMtime: statSync(join(root, 'real/item.ts')).mtimeMs, matches: 1, edits: [{ line: 1, column: 1, endLine: 1, endColumn: 6, newText: 'welcome' }] }], new Map([['real/item.ts', 'greet\n']]), 'typescript')
    if (!preview.ok || preview.action !== 'preview') throw new Error('No preview')
    expect(await previews.apply(root, { previewId: preview.previewId, dirtyPaths: ['alias/item.ts'] }, 'rename')).toMatchObject({ ok: true, files: [{ ok: false, conflict: true }] })
    expect(readFileSync(join(root, 'real/item.ts'), 'utf8')).toBe('greet\n')
  })
})

describe('replace in files', () => {
  const query = { action: 'preview' as const, query: 'greet', replacement: 'welcome', matchCase: true, wholeWord: true, regex: false, include: '*.ts' }
  it('previews counts per file and applies only the literal replacements', async () => {
    const root = fixture()
    writeFileSync(join(root, '.editorconfig'), 'root = true\n[*]\nend_of_line = crlf\ntrim_trailing_whitespace = true\ninsert_final_newline = true\n')
    const original = readFileSync(join(root, 'a.ts'), 'utf8')
    const previews = new EditPreviews()
    const preview = await replaceInFiles(root, query, previews)
    expect(preview).toMatchObject({ ok: true, action: 'preview', files: [expect.objectContaining({ path: 'a.ts', matches: 2 }), expect.objectContaining({ path: 'b.ts', matches: 2 })] })
    if (!preview.ok || preview.action !== 'preview') throw new Error('No preview')
    expect(await replaceInFiles(root, { action: 'apply', previewId: preview.previewId, dirtyPaths: [] }, previews)).toMatchObject({ ok: true, files: [expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })] })
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe(original.replaceAll('greet', 'welcome'))
  })
  it('honors regex captures and refuses changed mtimes and dirty files', async () => {
    const root = fixture()
    const previews = new EditPreviews()
    const preview = await replaceInFiles(root, { ...query, query: '(greet)', regex: true, replacement: '$1Again' }, previews)
    if (!preview.ok || preview.action !== 'preview') throw new Error('No preview')
    expect(preview.files[0].edits[0].newText).toBe('greetAgain')
    const before = statSync(join(root, 'b.ts')).mtimeMs
    writeFileSync(join(root, 'b.ts'), 'new contents')
    expect(statSync(join(root, 'b.ts')).mtimeMs).not.toBe(before)
    expect(await replaceInFiles(root, { action: 'apply', previewId: preview.previewId, dirtyPaths: ['a.ts'] }, previews)).toMatchObject({ ok: true, files: [expect.objectContaining({ conflict: true }), expect.objectContaining({ conflict: true })] })
  })
  it('rejects invalid queries, missing dirty-buffer lists, wrong folders and rename tokens', async () => {
    const root = fixture()
    const previews = new EditPreviews()
    expect(await replaceInFiles(root, { ...query, include: '../*' }, previews)).toMatchObject({ ok: false })
    expect(await replaceInFiles(root, { ...query, query: '(a+)+' , regex: true }, previews)).toMatchObject({ ok: false })
    const preview = await replaceInFiles(root, query, previews)
    if (!preview.ok || preview.action !== 'preview') throw new Error('No preview')
    expect(await replaceInFiles(root, { action: 'apply', previewId: preview.previewId }, previews)).toMatchObject({ ok: false })
    expect(await replaceInFiles(fixture(), { action: 'apply', previewId: preview.previewId, dirtyPaths: [] }, previews)).toMatchObject({ ok: false })
  })
  it('rejects replacement output above the save byte budget during preview', async () => {
    const root = fixture()
    expect(await replaceInFiles(root, { ...query, replacement: 'x'.repeat(600_000) }, new EditPreviews())).toMatchObject({ ok: false, error: expect.stringMatching(/large|budget|many/i) })
  })
  it.skipIf(process.platform !== 'win32')('refuses a dirty real file when Git search returns a tracked junction alias', async () => {
    const root = fixture()
    mkdirSync(join(root, 'real'))
    writeFileSync(join(root, 'real/item.ts'), 'greet\n')
    symlinkSync(join(root, 'real'), join(root, 'alias'), 'junction')
    execFileSync('git', ['add', 'alias/item.ts'], { cwd: root, windowsHide: true })
    const previews = new EditPreviews()
    const preview = await replaceInFiles(root, { ...query, include: 'alias/*.ts' }, previews)
    expect(preview).toMatchObject({ ok: true, files: [{ matches: 1 }] })
    if (!preview.ok || preview.action !== 'preview') throw new Error('No preview')
    expect(await replaceInFiles(root, { action: 'apply', previewId: preview.previewId, dirtyPaths: ['real/item.ts'] }, previews)).toMatchObject({ ok: true, files: [{ ok: false, conflict: true }] })
    expect(readFileSync(join(root, 'real/item.ts'), 'utf8')).toBe('greet\n')
  })
})
