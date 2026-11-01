import type { EditorConfigRules } from '../../shared/codeNav'

export interface IndentSettings {
  unit: string
  tabSize: number
}

const DEFAULT_TAB_SIZE = 4
const MAX_SIZE = 16

const sized = (value: number | undefined): number | null => (value !== undefined && Number.isInteger(value) && value >= 1 && value <= MAX_SIZE ? value : null)

/** The indent unit and tab width an `.editorconfig` asks for, or null when it says nothing about indentation. */
export function indentSettings(rules: EditorConfigRules | null | undefined): IndentSettings | null {
  if (!rules) return null
  const size = sized(rules.indentSize)
  const tab = sized(rules.tabWidth)
  if (rules.indentStyle === undefined && size === null && tab === null) return null
  if (rules.indentStyle === 'tab') return { unit: '\t', tabSize: tab ?? size ?? DEFAULT_TAB_SIZE }
  const width = size ?? tab ?? DEFAULT_TAB_SIZE
  return { unit: ' '.repeat(width), tabSize: tab ?? width }
}
