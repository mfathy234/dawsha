import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseBuffer, parseFromFilesSync, type ECFile, type Props } from 'editorconfig'
import type { EditorConfigRules } from '../shared/codeNav'
import { resolveProjectFile } from './gitWorkspace'
import { containsProjectPath as inside } from './projectContainment'

const size = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 256

async function configFiles(root: string, full: string): Promise<ECFile[]> {
  const files: ECFile[] = []
  let directory = dirname(full)
  while (inside(root, directory)) {
    const name = join(directory, '.editorconfig')
    try {
      const actual = await realpath(name)
      if (inside(root, actual) && (await stat(actual)).size <= 64 * 1024) {
        const contents = await readFile(actual)
        files.push({ name, contents })
        if (parseBuffer(contents)[0]?.[1].root?.toLowerCase() === 'true') break
      }
    } catch { /* A directory without a config inherits its parent's rules. */ }
    if (directory === root) break
    directory = dirname(directory)
  }
  return files
}

function rulesFrom(props: Props): EditorConfigRules {
  return {
    ...(props.indent_style === 'tab' || props.indent_style === 'space' ? { indentStyle: props.indent_style as 'tab' | 'space' } : {}),
    ...(size(props.indent_size) ? { indentSize: props.indent_size } : {}),
    ...(size(props.tab_width) ? { tabWidth: props.tab_width } : {}),
    ...(['lf', 'crlf', 'cr'].includes(String(props.end_of_line)) ? { endOfLine: props.end_of_line as EditorConfigRules['endOfLine'] } : {}),
    ...(typeof props.insert_final_newline === 'boolean' ? { insertFinalNewline: props.insert_final_newline } : {}),
    ...(typeof props.trim_trailing_whitespace === 'boolean' ? { trimTrailingWhitespace: props.trim_trailing_whitespace } : {})
  }
}

export async function editorConfig(folder: string, path: unknown): Promise<EditorConfigRules> {
  const target = await resolveProjectFile(folder, path)
  if (!target.ok && !target.missing) return {}
  try {
    const root = await realpath(folder)
    const full = target.ok ? target.full : join(target.missing!.realRoot, target.missing!.rel)
    if (!inside(root, full)) return {}
    return rulesFrom(parseFromFilesSync(full, await configFiles(root, full)))
  } catch { return {} }
}

export function saveWithRules(text: string, original: string, rules: EditorConfigRules): string {
  if (text === original) return text
  const breaks = original.match(/\r\n|\r|\n/g) ?? []
  const uniform = breaks.length > 0 && breaks.every(ending => ending === breaks[0])
  const ending = rules.endOfLine ? { lf: '\n', crlf: '\r\n', cr: '\r' }[rules.endOfLine] : uniform ? breaks[0] : undefined
  const normalized = ending ? text.replace(/\r\n|\r|\n/g, ending) : text
  const trimmed = rules.trimTrailingWhitespace ? normalized.replace(/[\t ]+(?=\r?\n|\r|$)/g, '') : normalized
  if (rules.insertFinalNewline === false) return trimmed.replace(/[\r\n]+$/, '')
  if (rules.insertFinalNewline && trimmed !== '' && !/[\r\n]$/.test(trimmed)) return trimmed + (ending ?? breaks.at(-1) ?? '\n')
  return trimmed
}
