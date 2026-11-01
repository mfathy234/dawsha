import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodeNavRouter } from '../../src/main/codeNav/router'
import type { NavigationClient } from '../../src/main/codeNav/tsserver'
import { findSolution } from '../../src/main/codeNav/csharp'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function fixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dawsha-router-')))
  roots.push(root)
  writeFileSync(join(root, 'a.ts'), 'interface Shape {}\nclass Circle implements Shape {}\n')
  return root
}
const request = { path: 'a.ts', symbol: 'Shape', line: 1, column: 12, kind: 'implementation' as const }
function client(): NavigationClient {
  return { state: 'starting', ready: Promise.resolve(), query: async () => { throw new Error('timed out') }, stop() { this.state = 'stopped' } }
}
describe('navigation router', () => {
  it('uses name search during startup, on timeout and after stop, then restarts on request', async () => {
    const root = fixture()
    const server = client()
    let starts = 0
    const router = new CodeNavRouter({ typescript: () => { starts++; return server }, csharp: async () => null, canInstall: async () => true })
    expect(await router.query(root, request)).toMatchObject({ engine: 'name', hits: [{ line: 2 }] })
    expect(await router.status(root, 'a.ts')).toEqual({ engine: 'typescript', state: 'starting', canInstall: false })
    server.state = 'ready'
    expect(await router.query(root, request)).toMatchObject({ engine: 'name' })
    server.state = 'stopped'
    expect(await router.query(root, request)).toMatchObject({ engine: 'name' })
    expect(starts).toBe(1)
    await router.restart(root, 'a.ts')
    await router.query(root, request)
    expect(starts).toBe(2)
    router.stop()
  })
  it('returns exact results with unsaved previews and refuses invalid paths before starting a server', async () => {
    const root = fixture()
    const server = client()
    server.state = 'ready'
    server.query = async (_file, text) => text.includes('Unsaved') ? [{ file: join(root, 'a.ts'), line: 2, column: 7 }] : []
    const router = new CodeNavRouter({ typescript: () => server, csharp: async () => null, canInstall: async () => false })
    expect(await router.query(root, { ...request, path: '../a.ts' })).toMatchObject({ ok: false })
    expect(await router.query(root, { ...request, unsavedText: 'interface Shape {}\nclass Unsaved implements Shape {}' })).toMatchObject({ engine: 'typescript', hits: [{ preview: 'class Unsaved implements Shape {}' }] })
    router.stop()
  })
  it('offers C# installation only for missing C# servers with a dotnet SDK', async () => {
    const root = fixture()
    writeFileSync(join(root, 'a.cs'), 'interface Shape {}')
    const router = new CodeNavRouter({ typescript: client, csharp: async () => null, canInstall: async () => true })
    expect(await router.status(root, 'a.cs')).toEqual({ engine: 'csharp', state: 'missing', canInstall: true })
    expect(await router.status(root, '../a.cs')).toEqual({ engine: 'name', state: 'none', canInstall: false })
    router.stop()
  })
  it('selects the nearest solution containing the file project among several solutions', async () => {
    const root = fixture()
    mkdirSync(join(root, 'app'))
    writeFileSync(join(root, 'app/Widget.csproj'), '<Project />')
    writeFileSync(join(root, 'app/Widget.cs'), 'class Widget {}')
    writeFileSync(join(root, 'A.sln'), 'Project("{type}") = "Other", "other/Other.csproj", "{id}"\nEndProject')
    writeFileSync(join(root, 'B.sln'), 'Project("{type}") = "Widget", "app\\Widget.csproj", "{id}"\nEndProject')
    expect(await findSolution(root, join(root, 'app/Widget.cs'))).toBe(join(root, 'B.sln'))
    writeFileSync(join(root, 'app/Nearest.sln'), 'Project("{type}") = "Widget", "Widget.csproj", "{id}"\nEndProject')
    expect(await findSolution(root, join(root, 'app/Widget.cs'))).toBe(join(root, 'app/Nearest.sln'))
  })
  it('discovers solutions through a project junction or symlink', async () => {
    const root = fixture()
    writeFileSync(join(root, 'Project.sln'), '')
    const alias = join(root, 'alias')
    symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(await findSolution(alias, join(root, 'a.ts'))).toBe(join(root, 'Project.sln'))
  })
  it('retains live engines when a C# installation invalidates missing-server discovery', async () => {
    const root = fixture()
    const server = client()
    let starts = 0
    const router = new CodeNavRouter({ typescript: () => { starts++; return server }, csharp: async () => null, canInstall: async () => true })
    await router.query(root, request)
    router.installed()
    await router.query(root, request)
    expect(starts).toBe(1)
    router.stop()
  })
  it('restarts the shared C# solution client for every file using it', async () => {
    const root = fixture()
    writeFileSync(join(root, 'a.cs'), 'interface Shape {}')
    writeFileSync(join(root, 'b.cs'), 'interface Shape {}')
    let server = client()
    server.state = 'ready'
    const router = new CodeNavRouter({ typescript: client, csharp: async () => {
      if (server.state === 'stopped') { server = client(); server.state = 'ready' }
      return server
    }, canInstall: async () => false })
    await router.status(root, 'a.cs')
    await router.status(root, 'b.cs')
    await router.restart(root, 'a.cs')
    await router.status(root, 'a.cs')
    expect(await router.status(root, 'b.cs')).toMatchObject({ state: 'ready' })
    router.stop()
  })
})
