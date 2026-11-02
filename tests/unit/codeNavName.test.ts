import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nameSearch } from '../../src/main/codeNav/nameSearch'
import { validateCodeNavRequest } from '../../src/main/codeNav/validation'

const roots: string[] = []
afterEach(() => roots.forEach(root => rmSync(root, { recursive: true, force: true })))
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-name-'))
  roots.push(root)
  writeFileSync(join(root, 'a.cs'), 'interface Shape {}\nclass Circle : Shape {}\nShape value;\nclass Square implements Shape {}\nclass Other extends Shape {}\nvoid Paint() {}\nPaint();\n')
  return root
}
const request = { kind: 'implementation' as const, path: 'a.cs', symbol: 'Shape', line: 1, column: 11 }
describe('name navigation', () => {
  it.each([false, true])('finds type implementations in git=%s', async git => {
    const root = fixture()
    if (git) execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true })
    const result = await nameSearch(root, request)
    expect(result).toMatchObject({ ok: true, engine: 'name', outside: false })
    expect(result.ok && result.hits.map(hit => hit.line)).toEqual([2, 4, 5])
  })
  it('finds same-named members, ranks definitions and searches unsaved text', async () => {
    const root = fixture()
    expect(await nameSearch(root, { ...request, symbol: 'Paint' })).toMatchObject({ hits: [{ path: 'a.cs', line: 6, column: 6 }] })
    const result = await nameSearch(root, { ...request, kind: 'definition', unsavedText: 'Shape value;\ninterface Shape {}\n' })
    expect(result.ok && result.hits[0]).toMatchObject({ line: 2, column: 11 })
  })
  it('uses full source lines for indented and long-line positions', async () => {
    const root = fixture()
    writeFileSync(join(root, 'a.cs'), '    class Circle : Shape {}\n' + ' '.repeat(260) + 'class Square : Shape {}\n')
    const result = await nameSearch(root, request)
    expect(result.ok && result.hits.map(hit => [hit.line, hit.column])).toEqual([[1, 20], [2, 276]])
  })
  it('recognizes type inheritance split across lines without treating typed variables as implementations', async () => {
    const root = fixture()
    writeFileSync(join(root, 'a.cs'), 'class Circle\n  : Shape {}\nclass Square implements\n  Shape {}\nShape value;\n')
    const result = await nameSearch(root, request)
    expect(result.ok && result.hits.map(hit => hit.line)).toEqual([2, 4])
  })
  it('finds a C# declaration past the search cap, when hundreds of uses sort before it', async () => {
    const root = fixture()
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(root, 'A'), { recursive: true })
    mkdirSync(join(root, 'Z'), { recursive: true })
    for (let file = 0; file < 12; file += 1) {
      writeFileSync(join(root, 'A', `Use${file}.cs`), Array.from({ length: 55 }, (_, line) => `var user${line} = new User(); User other${line};`).join('\n'))
    }
    writeFileSync(join(root, 'Z', 'User.cs'), 'namespace App;\n\npublic sealed class User\n{\n    public string Name { get; set; }\n}\n')
    execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true })
    execFileSync('git', ['add', '.'], { cwd: root, windowsHide: true })
    const result = await nameSearch(root, { kind: 'definition', path: 'A/Use0.cs', symbol: 'User', line: 1, column: 20 })
    expect(result.ok && result.hits[0]).toMatchObject({ path: 'Z/User.cs', line: 3 })
  })
  it('finds a C# method declaration rather than its calls', async () => {
    const root = fixture()
    writeFileSync(join(root, 'b.cs'), 'class Svc\n{\n    public async Task<int> Save(Order order) => 1;\n}\nawait svc.Save(order);\nSave(x);\n')
    const result = await nameSearch(root, { kind: 'definition', path: 'b.cs', symbol: 'Save', line: 5, column: 11 })
    expect(result.ok && result.hits[0]).toMatchObject({ path: 'b.cs', line: 3 })
  })
  it.each([null, {},{ ...request, line: 0 }, { ...request, column: Infinity }, { ...request, kind: 'execute' }, { ...request, path: '../secret' }, { ...request, unsavedText: 3 }])('rejects invalid requests', raw => {
    expect(validateCodeNavRequest(raw)).toBeNull()
  })
})
