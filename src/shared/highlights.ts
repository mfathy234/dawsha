import { withAlpha } from './contrast'

export type HighlightColor = 'red' | 'amber' | 'green' | 'blue' | 'purple'

export interface HighlightRule {
  pattern: string
  color: HighlightColor
  regex?: boolean
}

export interface HighlightSettings {
  enabled: boolean
  rules: HighlightRule[]
}

export const HIGHLIGHT_COLORS: HighlightColor[] = ['red', 'amber', 'green', 'blue', 'purple']
export const MAX_HIGHLIGHT_RULES = 30
export const HIGHLIGHT_PATTERN_MAX = 120
export const HIGHLIGHT_LINE_MAX = 2000

const TINTS: Record<HighlightColor, string> = {
  red: '#f85149',
  amber: '#e3a008',
  green: '#2ea043',
  blue: '#388bfd',
  purple: '#a371f7'
}

export const highlightTint = (color: HighlightColor): string => TINTS[color]

export const highlightAlpha = (kind: 'dark' | 'light'): number => (kind === 'light' ? 0.2 : 0.14)

export const highlightBackground = (color: HighlightColor, kind: 'dark' | 'light'): string =>
  withAlpha(TINTS[color], highlightAlpha(kind))

export const defaultHighlightRules = (): HighlightRule[] => [
  { pattern: 'error', color: 'red' },
  { pattern: 'failed', color: 'red' },
  { pattern: 'FAIL', color: 'red' },
  { pattern: 'exception', color: 'red' },
  { pattern: 'warning', color: 'amber' },
  { pattern: 'warn', color: 'amber' },
  { pattern: 'passed', color: 'green' },
  { pattern: '✓', color: 'green' },
  { pattern: 'success', color: 'green' }
]

export const defaultHighlights = (): HighlightSettings => ({ enabled: true, rules: defaultHighlightRules() })

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function compileRule(rule: HighlightRule): RegExp | null {
  try {
    return new RegExp(rule.regex === true ? rule.pattern : escapeRegex(rule.pattern), 'iu')
  } catch {
    return null
  }
}

export function validateRule(pattern: string, regex: boolean): string | null {
  const text = pattern.trim()
  if (text === '') return 'Enter a word or pattern.'
  if (text.length > HIGHLIGHT_PATTERN_MAX) return `Use at most ${HIGHLIGHT_PATTERN_MAX} characters.`
  if (regex) {
    const compiled = compileRule({ pattern: text, color: 'red', regex: true })
    if (!compiled) return 'That is not a valid regular expression.'
    if (compiled.test('')) return 'That pattern matches every line.'
  }
  return null
}

export function sanitizeRule(value: unknown): HighlightRule | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const pattern = typeof raw.pattern === 'string' ? raw.pattern.trim() : ''
  const color = HIGHLIGHT_COLORS.find((c) => c === raw.color)
  if (!color) return null
  const regex = raw.regex === true
  if (validateRule(pattern, regex) !== null) return null
  return regex ? { pattern, color, regex: true } : { pattern, color }
}

export function sanitizeHighlights(value: unknown): HighlightSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaultHighlights()
  const raw = value as Record<string, unknown>
  const enabled = raw.enabled !== false
  if (!Array.isArray(raw.rules)) return { enabled, rules: defaultHighlightRules() }
  const seen = new Set<string>()
  const rules: HighlightRule[] = []
  for (const item of raw.rules) {
    const rule = sanitizeRule(item)
    if (!rule) continue
    const key = `${rule.regex === true ? 'r' : 't'}:${rule.pattern.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    rules.push(rule)
  }
  return { enabled, rules: rules.slice(0, MAX_HIGHLIGHT_RULES) }
}

export const sameRules = (a: HighlightRule[], b: HighlightRule[]): boolean =>
  a.length === b.length &&
  a.every((rule, i) => rule.pattern === b[i].pattern && rule.color === b[i].color && (rule.regex === true) === (b[i].regex === true))

export interface CompiledRules {
  test(line: string): HighlightColor | null
}

export function compileRules(rules: HighlightRule[]): CompiledRules {
  const compiled = rules
    .map((rule) => ({ color: rule.color, expression: compileRule(rule) }))
    .filter((item): item is { color: HighlightColor; expression: RegExp } => item.expression !== null)
  return {
    test(line: string): HighlightColor | null {
      if (line.trim() === '') return null
      const text = line.length > HIGHLIGHT_LINE_MAX ? line.slice(0, HIGHLIGHT_LINE_MAX) : line
      for (const item of compiled) if (item.expression.test(text)) return item.color
      return null
    }
  }
}

export function describeRules(rules: HighlightRule[], limit = 6): string {
  const names = rules.slice(0, limit).map((rule) => rule.pattern)
  const more = rules.length - names.length
  return more > 0 ? `${names.join(', ')} and ${more} more` : names.join(', ')
}

export interface PreviewLine {
  text: string
  color: HighlightColor | null
  draft: boolean
}

export const PREVIEW_SAMPLE_LINES: readonly string[] = [
  'error: cannot find module "./config"',
  'warning: 2 unused variables',
  'FAIL src/auth.test.ts',
  '✓ 14 tests passed',
  'Build finished in 3.2s'
]

/** The sample terminal lines coloured by the rules as the terminal would, plus a line of the rule being typed when it is valid. */
export function highlightPreview(rules: HighlightRule[], draft: HighlightRule | null): PreviewLine[] {
  const compiled = compileRules(rules)
  const lines: PreviewLine[] = PREVIEW_SAMPLE_LINES.map((text) => ({ text, color: compiled.test(text), draft: false }))
  const pattern = draft?.pattern.trim() ?? ''
  if (draft && pattern !== '' && validateRule(pattern, draft.regex === true) === null && compileRule(draft)) {
    const sample = draft.regex === true ? `matches /${pattern}/` : `a line with ${pattern} in it`
    const matches = compileRule(draft)?.test(sample) === true
    lines.push({ text: matches ? sample : `a line with ${pattern.slice(0, 40)} in it`, color: matches ? draft.color : null, draft: true })
  }
  return lines
}
