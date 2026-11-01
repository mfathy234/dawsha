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
  it.each([null, {}, { ...request, line: 0 }, { ...request, column: Infinity }, { ...request, kind: 'execute' }, { ...request, path: '../secret' }, { ...request, unsavedText: 3 }])('rejects invalid requests', raw => {
    expect(validateCodeNavRequest(raw)).toBeNull()
  })
})
