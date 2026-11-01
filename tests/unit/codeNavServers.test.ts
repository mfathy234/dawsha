import { fork, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { TsServerClient } from '../../src/main/codeNav/tsserver'
import { LspClient } from '../../src/main/codeNav/lsp'
import { nodeIpcWire, stdioWire } from '../../src/main/codeNav/transport'
import { navigationHits } from '../../src/main/codeNav/locations'

const require = createRequire(import.meta.url)
const roots: string[] = []
const clients: { stop(): void }[] = []
const exits: Promise<unknown>[] = []
afterEach(async () => {
  clients.splice(0).forEach(client => client.stop())
  await Promise.all(exits.splice(0))
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-server-'))
  roots.push(root)
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true }, files: ['a.ts'] }))
  writeFileSync(join(root, 'a.ts'), 'interface Shape { paint(): void }\nclass Circle implements Shape { paint() {} }\nlet shape: Shape = new Circle();\nshape.paint();\n')
  return root
}

describe('tsserver', () => {
  it('resolves an interface definition and its implementation with the real server', async () => {
    const root = fixture()
    const options = { cwd: root, silent: true, windowsHide: true }
    const child = fork(require.resolve('typescript/lib/tsserver.js'), ['--useNodeIpc', '--disableAutomaticTypingAcquisition'], options)
    exits.push(once(child, 'exit'))
    const client = new TsServerClient(nodeIpcWire(child), 10_000)
    clients.push(client)
    await client.ready
    const file = join(root, 'a.ts')
    const text = 'interface Shape { paint(): void }\nclass Circle implements Shape { paint() {} }\nlet shape: Shape = new Circle();\nshape.paint();\n'
    expect(await client.query(file, text, { kind: 'definition', line: 3, column: 13 })).toContainEqual({ file, line: 1, column: 11 })
    expect(await client.query(file, text, { kind: 'implementation', line: 1, column: 12 })).toContainEqual({ file, line: 2, column: 7 })
    const unsaved = text.replace('class Circle', '\nclass Square').replace('new Circle()', 'new Square()')
    expect(await client.query(file, unsaved, { kind: 'implementation', line: 1, column: 12 })).toContainEqual({ file, line: 3, column: 7 })
    const concurrent = await Promise.all([
      client.query(file, text, { kind: 'implementation', line: 1, column: 12 }),
      client.query(file, unsaved, { kind: 'implementation', line: 1, column: 12 })
    ])
    expect(concurrent).toEqual([[{ file, line: 2, column: 7 }], [{ file, line: 3, column: 7 }]])
    expect(await client.query(file, text, { kind: 'references', line: 1, column: 12 })).toEqual(expect.arrayContaining([{ file, line: 3, column: 12 }]))
  })
  it('uses new disk contents when navigating from a different file after an agent edit', async () => {
    const root = fixture()
    const file = join(root, 'a.ts')
    const text = 'export interface Shape {}\nexport class Circle implements Shape {}\n'
    writeFileSync(file, text)
    writeFileSync(join(root, 'b.ts'), 'import { Shape } from "./a";\nlet value: Shape;\n')
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ files: ['a.ts', 'b.ts'] }))
    const options = { cwd: root, silent: true, windowsHide: true }
    const child = fork(require.resolve('typescript/lib/tsserver.js'), ['--useNodeIpc', '--disableAutomaticTypingAcquisition'], options)
    exits.push(once(child, 'exit'))
    const client = new TsServerClient(nodeIpcWire(child), 10_000)
    clients.push(client)
    await client.ready
    await client.query(file, text, { kind: 'implementation', line: 1, column: 19 })
    writeFileSync(file, 'export interface Shape {}\n\n\n\nexport class Square implements Shape {}\n')
    const results = await client.query(join(root, 'b.ts'), 'import { Shape } from "./a";\nlet value: Shape;\n', { kind: 'implementation', line: 2, column: 13 })
    expect(results).toContainEqual({ file, line: 5, column: 14 })
  })
})

const fakeServer = String.raw`
let input = Buffer.alloc(0), opened, changed, closes = 0;
const send = value => {
  const data = Buffer.from(JSON.stringify(value));
  const frame = Buffer.concat([Buffer.from('Content-Length: ' + data.length + '\r\n\r\n'), data]);
  process.stdout.write(frame.subarray(0, 11));
  setTimeout(() => process.stdout.write(frame.subarray(11)), 1);
};
const handle = msg => {
  if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { textDocumentSync: 1 } } });
  if (msg.method === 'textDocument/didOpen') { opened = msg.params.textDocument; changed = undefined; }
  if (msg.method === 'textDocument/didChange') changed = msg.params.contentChanges[0].text;
  if (msg.method === 'textDocument/didClose') closes++;
  if (msg.method === 'textDocument/definition' && (changed || opened.text) === 'metadata') send({ jsonrpc: '2.0', id: msg.id, result: { uri: 'csharp:/metadata/System.String', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } } } });
  if (msg.method === 'textDocument/implementation') {
    const text = changed || opened.text;
    const good = text.includes('unsaved') && (!text.includes('again') || closes > 0) && msg.params.position.line === 0 && msg.params.position.character === 2;
    send({ jsonrpc: '2.0', id: msg.id, result: good ? [{ targetUri: opened.uri, targetRange: { start: { line: 2, character: 4 }, end: { line: 2, character: 8 } }, targetSelectionRange: { start: { line: 2, character: 6 }, end: { line: 2, character: 8 } } }] : [] });
  }
};
process.stdin.on('data', chunk => {
  input = Buffer.concat([input, chunk]);
  for (;;) {
    const end = input.indexOf('\r\n\r\n');
    if (end < 0) return;
    const len = Number(/Content-Length: (\d+)/i.exec(input.subarray(0, end).toString())[1]);
    if (input.length < end + 4 + len) return;
    const msg = JSON.parse(input.subarray(end + 4, end + 4 + len).toString());
    input = input.subarray(end + 4 + len);
    handle(msg);
  }
});
`
function fakeClient(root: string, timeout = 2000): LspClient {
  const script = join(root, 'fake-lsp.cjs')
  writeFileSync(script, fakeServer)
  const child = spawn(process.execPath, [script], { cwd: root, windowsHide: true, shell: false })
  exits.push(once(child, 'exit'))
  const client = new LspClient(stdioWire(child), root, null, timeout)
  clients.push(client)
  return client
}
describe('C# LSP', () => {
  it('sends implementation, UTF-16 positions and unsaved changes, and reads fragmented LocationLinks', async () => {
    const root = fixture()
    const client = fakeClient(root)
    await client.ready
    expect(await client.query(join(root, 'a.cs'), 'unsaved ✓', { kind: 'implementation', line: 1, column: 3 })).toEqual([{ file: join(root, 'a.cs'), line: 3, column: 7 }])
    expect(await client.query(join(root, 'a.cs'), 'unsaved again', { kind: 'implementation', line: 1, column: 3 })).toHaveLength(1)
    const metadata = await client.query(join(root, 'a.cs'), 'metadata', { kind: 'definition', line: 1, column: 1 })
    expect(await navigationHits(root, metadata, 'csharp')).toMatchObject({ ok: true, outside: true, hits: [] })
  })
  it('times out unresponsive requests and rejects pending requests on stop', async () => {
    const root = fixture()
    const client = fakeClient(root, 250)
    await client.ready
    await expect(client.query(join(root, 'a.cs'), 'x', { kind: 'definition', line: 1, column: 1 })).rejects.toThrow(/timed out/i)
    const pending = client.query(join(root, 'a.cs'), 'x', { kind: 'references', line: 1, column: 1 })
    client.stop()
    await expect(pending).rejects.toThrow(/stopped/i)
  })
  it('marks external results without returning or reading their contents', async () => {
    const root = fixture()
    const result = await navigationHits(root, [{ file: join(root, '../secret.ts'), line: 1, column: 1 }, { file: join(root, 'a.ts'), line: 2, column: 7 }], 'typescript')
    expect(result).toMatchObject({ ok: true, outside: true, hits: [{ path: 'a.ts', line: 2, column: 7, preview: 'class Circle implements Shape { paint() {} }' }] })
  })
})
