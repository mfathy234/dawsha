import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { staleCallers } from '../../src/main/codeNav/staleCallers'
import { CodeNavRouter } from '../../src/main/codeNav/router'
import { changedSymbols } from '../../src/main/codeNav/changedSymbols'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })))
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-stale-'))
  roots.push(root)
  const git = (args: string[]): void => { execFileSync('git', args, { cwd: root, windowsHide: true }) }
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', 'Tests'])
  git(['config', 'user.email', 'tests@example.test'])
  git(['config', 'core.autocrlf', 'false'])
  writeFileSync(join(root, 'a.ts'), 'export function greet() {\n  return "old";\n}\nexport interface Shape { paint(): void }\n')
  writeFileSync(join(root, 'b.ts'), 'import { greet, Shape } from "./a";\nclass Circle implements Shape { paint() { greet(); } }\n')
  writeFileSync(join(root, 'c.ts'), 'import { greet } from "./a";\ngreet();\n')
  git(['add', 'a.ts', 'b.ts', 'c.ts'])
  git(['commit', '-qm', 'initial'])
  writeFileSync(join(root, 'a.ts'), 'export function greet() {\n  return "new";\n}\nexport interface Shape { paint(color: string): void }\n')
  writeFileSync(join(root, 'c.ts'), 'import { greet } from "./a";\ngreet(); // already touched\n')
  return root
}
function router(): CodeNavRouter {
  return new CodeNavRouter({ typescript: () => ({ state: 'stopped', ready: Promise.resolve(), query: async () => [], stop() {} }), csharp: async () => null, canInstall: async () => false })
}
it('finds body and interface changes, labels guesses, excludes every changed file', async () => {
  const root = fixture()
  const result = await staleCallers(root, router())
  expect(result).toMatchObject({ ok: true, stoppedEarly: false, symbols: expect.arrayContaining([
    expect.objectContaining({ symbol: expect.objectContaining({ path: 'a.ts', preview: expect.stringContaining('function greet') }), engine: 'name', references: expect.arrayContaining([expect.objectContaining({ path: 'b.ts', line: 2 })]) }),
    expect.objectContaining({ symbol: expect.objectContaining({ preview: expect.stringContaining('interface Shape') }), implementations: expect.arrayContaining([expect.objectContaining({ path: 'b.ts', line: 2 })]) })
  ]) })
  if (!result.ok) throw new Error(result.error)
  expect(result.symbols.flatMap(item => [...item.references, ...item.implementations]).every(hit => hit.path === 'b.ts')).toBe(true)
})
it('reports a symbol cap and a hard timeout with partial results', async () => {
  const root = fixture()
  expect(await staleCallers(root, router(), { symbolCap: 1, timeoutMs: 5000 })).toMatchObject({ ok: true, stoppedEarly: true, reason: 'symbolCap', scannedSymbols: 1 })
  const started = Date.now()
  expect(await staleCallers(root, { query: async () => new Promise(() => undefined) }, { symbolCap: 10, timeoutMs: 300 })).toMatchObject({ ok: true, stoppedEarly: true, reason: 'timeout' })
  expect(Date.now() - started).toBeLessThan(1500)
})
it('still finds references to a deleted declaration using honest name search', async () => {
  const root = fixture()
  writeFileSync(join(root, 'a.ts'), 'export interface Shape { paint(): void }\n')
  const result = await staleCallers(root, router())
  expect(result).toMatchObject({ ok: true, symbols: expect.arrayContaining([expect.objectContaining({ engine: 'name', symbol: expect.objectContaining({ preview: expect.stringContaining('function greet') }), references: expect.arrayContaining([expect.objectContaining({ path: 'b.ts' })]) })]) })
})
it('keeps generated-file discovery off the main thread and bounds its results', async () => {
  const text = Array.from({ length: 5000 }, (_, index) => `export function f${index}() { return ${index}; }`).join('\n')
  const discovery = changedSymbols('generated.ts', text, new Set([1, 2, 3, 4, 5]))
  const pulse = new Promise<string>(resolve => setTimeout(() => resolve('responsive'), 0))
  expect(await Promise.race([Promise.resolve(discovery).then(() => 'blocked'), pulse])).toBe('responsive')
  expect(await discovery).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'f0', line: 1 })]))
})
it('recognizes C# method body changes with an opening brace on the next line', async () => {
  const text = 'class Widget\n{\n  public void Paint()\n  {\n    Changed();\n  }\n}\n'
  expect(await changedSymbols('a.cs', text, new Set([5]))).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Paint', line: 3, column: 15 })]))
})
