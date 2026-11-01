/** Self-contained worker source: packaged Electron and vitest both use the installed TypeScript module. */
export const SYMBOL_DISCOVERY_SOURCE = String.raw`
const { parentPort, workerData: input } = require('node:worker_threads');
const lines = input.text.split(/\r\n|\r|\n/);
const changed = [...new Set(input.lines)].sort((a,b) => a-b);
const names = new Set(input.names);
const out = [];
function intersects(from, to) {
  let low = 0, high = changed.length;
  while (low < high) { const mid = (low+high) >>> 1; if (changed[mid] < from) low=mid+1; else high=mid; }
  return low < changed.length && changed[low] <= to;
}
function add(name, line, column, endLine) {
  if (intersects(line,endLine) || names.has(name)) out.push({path:input.path,name,line,column,endLine,preview:lines[line-1].trim()});
}
function typescript() {
  const ts = require(input.typescript);
  const source = ts.createSourceFile(input.path,input.text,ts.ScriptTarget.Latest,true);
  function visit(node) {
    if(out.length>=input.limit) return;
    const named = ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isMethodDeclaration(node)||ts.isMethodSignature(node)||ts.isTypeAliasDeclaration(node)||ts.isEnumDeclaration(node)||(ts.isVariableDeclaration(node)&&node.initializer&&(ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer)));
    if(named&&node.name&&ts.isIdentifier(node.name)) {
      const start=source.getLineAndCharacterOfPosition(node.name.getStart(source));
      const end=source.getLineAndCharacterOfPosition(node.end);
      add(node.name.text,start.line+1,start.character+1,end.line+1);
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
}
function other() {
  const declaration=/\b(?:class|interface|struct|record|enum|def|function)\s+([\p{L}_$][\p{L}\p{N}_$]*)|(?:^|\s)(?:[\w<>[\],?]+\s+)+([\p{L}_$][\p{L}\p{N}_$]*)\s*(?:<[^(){};]*>)?\([^;]*\)\s*(?:\{|=>|;|$)/u;
  for(let index=0;index<lines.length&&out.length<input.limit;index++) {
    const line=lines[index], match=declaration.exec(line), name=match&&(match[1]||match[2]);
    if(!name) continue;
    let end=index,depth=0,opened=false;
    const python=/\.py$/i.test(input.path),indent=line.search(/\S/);
    for(;end<lines.length;end++) {
      const current=lines[end];
      if(python&&end>index&&current.trim()&&current.search(/\S/)<=indent) break;
      for(const char of current) { if(char==='{'){depth++;opened=true;} if(char==='}')depth--; }
      if(opened&&depth<=0){end++;break;}
      if(!python&&!opened&&/;/.test(current)){end++;break;}
    }
    add(name,index+1,line.indexOf(name,match.index)+1,Math.max(index+1,end));
  }
}
if(/\.[cm]?[jt]sx?$/i.test(input.path)) typescript(); else other();
parentPort.postMessage(out);
`
