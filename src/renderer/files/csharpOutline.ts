import type { OutlineItem } from './outline'

const MODIFIERS = '(?:(?:public|internal|private|protected|static|sealed|abstract|partial|unsafe|readonly|file|new|virtual|override|async|extern|required)\\s+)*'
const TYPE_LINE = new RegExp(`^\\s*(?:\\[[^\\]]*\\]\\s*)*${MODIFIERS}(class|struct|interface|enum|record(?:\\s+(?:class|struct))?)\\s+([A-Za-z_]\\w*)`)
const METHOD_LINE = new RegExp(`^\\s*(?:\\[[^\\]]*\\]\\s*)*${MODIFIERS}(?:[\\w<>\\[\\],.?]+\\s+)+([A-Za-z_]\\w*)\\s*(?:<[^>(]*>)?\\s*\\(`)
const PROPERTY_LINE = new RegExp(`^\\s*(?:\\[[^\\]]*\\]\\s*)*${MODIFIERS}[\\w<>\\[\\],.?]+\\s+([A-Za-z_]\\w*)\\s*(?:\\{\\s*(?:get|set|init)\\b|=>)`)
const STATEMENT_START = /^\s*(?:if|else|for|foreach|while|do|switch|using|lock|return|throw|await|yield|var|catch|try|goto|case|break|continue)\b/

const KIND_OF: Record<string, OutlineItem['kind']> = { class: 'class', struct: 'class', record: 'class', interface: 'type', enum: 'type' }

/** Braces on a line, ignoring strings and comments well enough to keep the nesting right. */
function braceDelta(line: string): number {
  const bare = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/.*$/g, '')
  let delta = 0
  for (const char of bare) {
    if (char === '{') delta += 1
    else if (char === '}') delta -= 1
  }
  return delta
}

/**
 * A regex outline for C#, because the legacy highlighting mode has no syntax tree. Lists types and, directly inside a
 * type, its methods and properties. It is a best effort: odd formatting can hide a member, but it never invents one
 * inside a method body.
 */
export function csharpOutline(text: string): OutlineItem[] {
  const out: OutlineItem[] = []
  const open: Array<{ depth: number; entered: boolean }> = []
  let depth = 0
  let offset = 0
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const start = offset + (line.length - line.trimStart().length)
    offset += line.length + 1
    const insideType = open.length > 0
    const atMember = insideType && depth === open[open.length - 1].depth + 1
    const type = !STATEMENT_START.test(line) && (!insideType || atMember) ? TYPE_LINE.exec(line) : null
    if (type) {
      out.push({ name: type[2], kind: KIND_OF[type[1].split(/\s/)[0]], from: start, line: index + 1, depth: open.length })
      open.push({ depth, entered: false })
    } else if (atMember && !STATEMENT_START.test(line)) {
      const member = METHOD_LINE.exec(line) ?? PROPERTY_LINE.exec(line)
      if (member) out.push({ name: member[1], kind: METHOD_LINE.test(line) ? 'function' : 'const', from: start, line: index + 1, depth: open.length })
    }
    depth += braceDelta(line)
    const top = open[open.length - 1]
    if (top && (depth > top.depth || line.includes('{'))) top.entered = true
    while (open.length > 0 && open[open.length - 1].entered && depth <= open[open.length - 1].depth) open.pop()
  }
  return out
}
