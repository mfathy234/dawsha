import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { LspClient } from '../../src/main/codeNav/lsp'
import { stdioWire } from '../../src/main/codeNav/transport'
import { CodeNavRouter } from '../../src/main/codeNav/router'
import { CodeNavExtras } from '../../src/main/codeNav/extras'
import { EditPreviews } from '../../src/main/codeNav/editPreviews'

let root: string
let client: LspClient
let exited: Promise<unknown>
afterEach(async () => { client?.stop(); await exited; if (root) rmSync(root, { recursive: true, force: true }) })
const fake = String.raw`
let input = Buffer.alloc(0), doc, opened = false;
const send = (id, result) => { const data = JSON.stringify({jsonrpc:'2.0', id, result}); process.stdout.write('Content-Length: '+Buffer.byteLength(data)+'\r\n\r\n'+data); };
const pos = {line:0,character:6}, range = {start:pos,end:{line:0,character:12}};
const handle = msg => {
  if(msg.method==='initialize') return send(msg.id,{capabilities:{hoverProvider:true,renameProvider:true,callHierarchyProvider:true}});
  if(msg.method==='textDocument/didOpen') { if(opened) process.exit(2); doc=msg.params.textDocument; opened=true; }
  if(msg.method==='textDocument/didClose') opened=false;
  if(msg.method==='textDocument/hover') return send(msg.id,{contents:{kind:'markdown',value:'**Widget** documentation'}});
  if(msg.method==='textDocument/rename') return send(msg.id,{documentChanges:[{textDocument:{uri:doc.uri,version:1},edits:[{range,newText:msg.params.newName}]}]});
  if(msg.method==='textDocument/prepareCallHierarchy') return send(msg.id,[{name:'Widget',kind:5,uri:doc.uri,range,selectionRange:range,data:{keep:true}}]);
  if(msg.method==='callHierarchy/incomingCalls') return send(msg.id,[{from:{...msg.params.item,name:'Caller'},fromRanges:[{start:{line:1,character:2},end:{line:1,character:8}}]}]);
  if(msg.method==='callHierarchy/outgoingCalls') return send(msg.id,[{to:{...msg.params.item,name:'Callee'},fromRanges:[range]}]);
};
process.stdin.on('data',data=>{ input=Buffer.concat([input,data]); for(;;){const end=input.indexOf('\r\n\r\n');if(end<0)return;const len=Number(/Content-Length: (\d+)/i.exec(input.subarray(0,end).toString())[1]);if(input.length<end+4+len)return;const msg=JSON.parse(input.subarray(end+4,end+4+len));input=input.subarray(end+4+len);handle(msg);} });
`
async function fixture(): Promise<CodeNavExtras> {
  root = mkdtempSync(join(tmpdir(), 'dawsha-extras-lsp-'))
  writeFileSync(join(root, 'a.cs'), 'class Widget {}\n  Widget w;\n')
  writeFileSync(join(root, 'server.cjs'), fake)
  const child = spawn(process.execPath, [join(root, 'server.cjs')], { windowsHide: true, shell: false })
  exited = once(child, 'exit')
  client = new LspClient(stdioWire(child), root, null)
  await client.ready
  return new CodeNavExtras(new CodeNavRouter({ typescript: () => { throw new Error('Unexpected TypeScript') }, csharp: async () => client, canInstall: async () => false }), new EditPreviews())
}
const request = { path: 'a.cs', symbol: 'Widget', line: 1, column: 7 }
it('supports C# hover, workspace rename and both call directions over real stdio', async () => {
  const extras = await fixture()
  expect(await extras.hover(root, request)).toMatchObject({ ok: true, engine: 'csharp', documentation: '**Widget** documentation' })
  const preview = await extras.renameSymbol(root, { ...request, action: 'preview', newName: 'Gadget' })
  expect(preview).toMatchObject({ ok: true, engine: 'csharp', files: [{ path: 'a.cs', matches: 1 }] })
  if (!preview.ok || preview.action !== 'preview') throw new Error('No preview')
  expect(await extras.renameSymbol(root, { action: 'apply', previewId: preview.previewId, dirtyPaths: [] })).toMatchObject({ ok: true, files: [{ ok: true }] })
  expect(readFileSync(join(root, 'a.cs'), 'utf8')).toContain('class Gadget')
  expect(await extras.callHierarchy(root, { ...request, direction: 'incoming' })).toMatchObject({ ok: true, engine: 'csharp', items: [{ name: 'Caller', calls: [{ line: 2, column: 3 }] }] })
  expect(await extras.callHierarchy(root, { ...request, direction: 'outgoing' })).toMatchObject({ ok: true, items: [{ name: 'Callee', calls: [{ line: 1, column: 7 }] }] })
})
