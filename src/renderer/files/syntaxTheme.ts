import { HighlightStyle } from '@codemirror/language'
import { tags as t, type Tag } from '@lezer/highlight'
import { SYNTAX_COLORS, type SyntaxKind, type SyntaxRole } from '../../shared/syntaxPalette'

type Look = { role: SyntaxRole | null; italic?: boolean; bold?: boolean; underline?: boolean; strike?: boolean }

// One table for every language pack: the Lezer packs and the legacy modes (clike, shell, powershell) both name their
// tokens with these tags, so a tag is coloured the same wherever it comes from. Children inherit from their parent tag.
const LOOKS: readonly (readonly [Tag, Look])[] = [
  [t.keyword, { role: 'keyword' }],
  [t.controlKeyword, { role: 'control' }],
  [t.moduleKeyword, { role: 'control' }],
  [t.meta, { role: 'control' }],
  [t.processingInstruction, { role: 'control' }],
  [t.atom, { role: 'keyword' }],
  [t.bool, { role: 'keyword' }],
  [t.null, { role: 'keyword' }],
  [t.self, { role: 'keyword' }],
  [t.number, { role: 'number' }],
  [t.unit, { role: 'number' }],
  [t.color, { role: 'number' }],
  [t.string, { role: 'string' }],
  [t.special(t.string), { role: 'string' }],
  [t.attributeValue, { role: 'string' }],
  [t.monospace, { role: 'string' }],
  [t.deleted, { role: 'string' }],
  [t.regexp, { role: 'regexp' }],
  [t.escape, { role: 'escape' }],
  [t.comment, { role: 'comment', italic: true }],
  [t.documentMeta, { role: 'comment', italic: true }],
  [t.quote, { role: 'comment', italic: true }],
  [t.variableName, { role: 'variable' }],
  [t.special(t.variableName), { role: 'variable' }],
  [t.constant(t.variableName), { role: 'constant' }],
  [t.function(t.variableName), { role: 'function' }],
  [t.function(t.propertyName), { role: 'function' }],
  [t.standard(t.variableName), { role: 'function' }],
  [t.macroName, { role: 'function' }],
  [t.propertyName, { role: 'variable' }],
  [t.labelName, { role: 'variable' }],
  [t.typeName, { role: 'type' }],
  [t.className, { role: 'type' }],
  [t.namespace, { role: 'type' }],
  [t.annotation, { role: 'type' }],
  [t.tagName, { role: 'tag' }],
  [t.angleBracket, { role: 'tag' }],
  [t.attributeName, { role: 'attribute' }],
  [t.punctuation, { role: 'punctuation' }],
  [t.operator, { role: 'punctuation' }],
  [t.heading, { role: 'keyword', bold: true }],
  [t.list, { role: 'keyword' }],
  [t.contentSeparator, { role: 'keyword' }],
  [t.inserted, { role: 'number' }],
  [t.changed, { role: 'keyword' }],
  [t.link, { role: 'link', underline: true }],
  [t.url, { role: 'link' }],
  [t.invalid, { role: 'invalid' }],
  [t.strong, { role: null, bold: true }],
  [t.emphasis, { role: null, italic: true }],
  [t.strikethrough, { role: null, strike: true }]
]

/** The role a tag is coloured as: the most specific entry among the tag itself and its parent tags. */
export function roleOfTag(tag: Tag): SyntaxRole | null {
  for (const candidate of tag.set) {
    const hit = LOOKS.find(([known]) => known === candidate)
    if (hit) return hit[1].role
  }
  return null
}

export function highlightStyleFor(kind: SyntaxKind): HighlightStyle {
  const colors = SYNTAX_COLORS[kind]
  return HighlightStyle.define(LOOKS.map(([tag, look]) => ({
    tag,
    ...(look.role ? { color: colors[look.role] } : {}),
    ...(look.italic ? { fontStyle: 'italic' } : {}),
    ...(look.bold ? { fontWeight: '700' } : {}),
    ...(look.underline ? { textDecoration: 'underline' } : {}),
    ...(look.strike ? { textDecoration: 'line-through' } : {})
  })))
}
