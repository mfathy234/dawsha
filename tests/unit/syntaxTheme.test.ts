import { describe, expect, it } from 'vitest'
import { StreamLanguage, type Language } from '@codemirror/language'
import { highlightTree, tags as t } from '@lezer/highlight'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { csharp } from '@codemirror/legacy-modes/mode/clike'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { highlightStyleFor, roleOfTag } from '../../src/renderer/files/syntaxTheme'
import { EDITOR_COLORS, SYNTAX_COLORS, syntaxColor, type SyntaxKind } from '../../src/shared/syntaxPalette'

// Colour of every highlighted token of `code`, keyed by the token text, read back from the style sheet CodeMirror would apply.
function colours(language: Language, code: string, kind: SyntaxKind): Map<string, string> {
  const style = highlightStyleFor(kind)
  const rules = style.module?.getRules() ?? ''
  const colorOf = new Map<string, string>()
  for (const match of rules.matchAll(/\.([^\s{]+)\s*\{([^}]*)\}/g)) {
    const color = /(?:^|;|\s)color:\s*([^;]+)/.exec(match[2])
    if (color) colorOf.set(match[1], color[1].trim())
  }
  const out = new Map<string, string>()
  highlightTree(language.parser.parse(code), style, (from, to, classes) => {
    const color = classes.split(' ').map((name) => colorOf.get(name)).find(Boolean)
    if (color) out.set(code.slice(from, to), color)
  })
  return out
}

const LANGUAGES = {
  javascript: javascript({ typescript: true, jsx: true }).language,
  json: json().language,
  css: css().language,
  html: html().language,
  python: python().language,
  markdown: markdown().language,
  sql: sql().language,
  yaml: yaml().language,
  csharp: StreamLanguage.define(csharp),
  shell: StreamLanguage.define(shell),
  powershell: StreamLanguage.define(powerShell)
}

describe('palette values', () => {
  it('uses the approved VS Code Dark+ colours', () => {
    const dark = SYNTAX_COLORS.dark
    expect([dark.keyword, dark.control, dark.function, dark.type, dark.string, dark.variable, dark.comment, dark.number, dark.tag, dark.attribute, dark.punctuation])
      .toEqual(['#569cd6', '#c586c0', '#dcdcaa', '#4ec9b0', '#ce9178', '#9cdcfe', '#6a9955', '#b5cea8', '#569cd6', '#9cdcfe', '#d4d4d4'])
    expect(EDITOR_COLORS.dark).toMatchObject({ background: '#1e1e1e', gutter: '#858585' })
  })

  it('uses the approved Light+ colours', () => {
    const light = SYNTAX_COLORS.light
    expect([light.keyword, light.control, light.function, light.type, light.string, light.variable, light.comment, light.number, light.tag, light.attribute])
      .toEqual(['#0000ff', '#af00db', '#795e26', '#267f99', '#a31515', '#001080', '#008000', '#098658', '#800000', '#e50000'])
    expect(EDITOR_COLORS.light.background).toBe('#ffffff')
  })
})

describe('roleOfTag', () => {
  it('maps tags to roles and lets a specific tag beat its parent', () => {
    expect(roleOfTag(t.keyword)).toBe('keyword')
    expect(roleOfTag(t.definitionKeyword)).toBe('keyword')
    expect(roleOfTag(t.controlKeyword)).toBe('control')
    expect(roleOfTag(t.moduleKeyword)).toBe('control')
    expect(roleOfTag(t.function(t.variableName))).toBe('function')
    expect(roleOfTag(t.definition(t.function(t.variableName)))).toBe('function')
    expect(roleOfTag(t.definition(t.variableName))).toBe('variable')
    expect(roleOfTag(t.typeName)).toBe('type')
    expect(roleOfTag(t.lineComment)).toBe('comment')
    expect(roleOfTag(t.integer)).toBe('number')
    expect(roleOfTag(t.docString)).toBe('string')
    expect(roleOfTag(t.angleBracket)).toBe('tag')
    expect(roleOfTag(t.paren)).toBe('punctuation')
    expect(roleOfTag(t.strong)).toBeNull()
  })
})

describe('highlight style', () => {
  for (const kind of ['dark', 'light'] as const) {
    const c = (role: Parameters<typeof syntaxColor>[1]) => syntaxColor(kind, role)

    it(`colours TypeScript like VS Code ${kind === 'dark' ? 'Dark+' : 'Light+'}`, () => {
      const out = colours(LANGUAGES.javascript, "import { a } from 'x'\nexport type Theme = 'dark'\n// note\nconst n = 3\nfunction run() { if (n) return null }\nrun()\n", kind)
      expect(out.get('import')).toBe(c('control'))
      expect(out.get('from')).toBe(c('control'))
      expect(out.get('export')).toBe(c('control'))
      expect(out.get('const')).toBe(c('keyword'))
      expect(out.get('function')).toBe(c('keyword'))
      expect(out.get('if')).toBe(c('control'))
      expect(out.get('return')).toBe(c('control'))
      expect(out.get('null')).toBe(c('keyword'))
      expect(out.get("'x'")).toBe(c('string'))
      expect(out.get('Theme')).toBe(c('type'))
      expect(out.get('// note')).toBe(c('comment'))
      expect(out.get('3')).toBe(c('number'))
    })
  }

  it('colours the other language packs', () => {
    const kind = 'dark'
    const c = (role: Parameters<typeof syntaxColor>[1]) => syntaxColor(kind, role)
    expect(colours(LANGUAGES.json, '{"name": "dawsha", "n": 1, "ok": true}', kind).get('"dawsha"')).toBe(c('string'))
    expect(colours(LANGUAGES.json, '{"name": "dawsha", "n": 1, "ok": true}', kind).get('"name"')).toBe(c('variable'))
    expect(colours(LANGUAGES.json, '{"n": 1}', kind).get('1')).toBe(c('number'))
    const page = colours(LANGUAGES.html, '<div class="a">hi</div>', kind)
    expect(page.get('div')).toBe(c('tag'))
    expect(page.get('class')).toBe(c('attribute'))
    expect(page.get('"a"')).toBe(c('string'))
    expect(colours(LANGUAGES.css, 'a { color: red; margin: 4px }', kind).get('color')).toBe(c('variable'))
    const py = colours(LANGUAGES.python, 'def run(n):\n    # hi\n    return "s"\n', kind)
    expect(py.get('def')).toBe(c('keyword'))
    expect(py.get('return')).toBe(c('control'))
    expect(py.get('"s"')).toBe(c('string'))
    expect(py.get('# hi')).toBe(c('comment'))
    expect(colours(LANGUAGES.yaml, 'name: dawsha\nn: 3\n', kind).size).toBeGreaterThan(0)
    expect(colours(LANGUAGES.sql, 'SELECT 1 FROM t -- c', kind).get('SELECT')).toBe(c('keyword'))
    expect(colours(LANGUAGES.markdown, '# Title\n\n`code`\n', kind).size).toBeGreaterThan(0)
  })

  it('colours the legacy modes: C#, shell and PowerShell', () => {
    const kind = 'dark'
    const c = (role: Parameters<typeof syntaxColor>[1]) => syntaxColor(kind, role)
    const cs = colours(LANGUAGES.csharp, 'public class Foo { string s = "x"; // hi\n int n = 4; }', kind)
    expect(cs.get('public')).toBe(c('keyword'))
    expect(cs.get('class')).toBe(c('keyword'))
    expect(cs.get('"x"')).toBe(c('string'))
    expect(cs.get('// hi')).toBe(c('comment'))
    expect(cs.get('4')).toBe(c('number'))
    const sh = colours(LANGUAGES.shell, 'if [ -f x ]; then echo "hi" # c\nfi\n', kind)
    expect(sh.get('"hi"')).toBe(c('string'))
    expect(sh.get('# c')).toBe(c('comment'))
    expect(sh.get('if')).toBe(c('keyword'))
    const ps = colours(LANGUAGES.powershell, 'function Get-X { param($a) "s" # c\n}', kind)
    expect(ps.get('function')).toBe(c('keyword'))
    expect(ps.get('"s"')).toBe(c('string'))
    expect(ps.get('# c')).toBe(c('comment'))
  })
})
