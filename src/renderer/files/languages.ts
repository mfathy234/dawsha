import type { Extension } from '@codemirror/state'
import { StreamLanguage, type StreamParser } from '@codemirror/language'

import { braceFolding } from './braceFold'
import { languageKey, type LanguageKey } from './languageInfo'

export { languageKey, languageLabel, type LanguageKey } from './languageInfo'

const legacy = (parser: StreamParser<unknown>): Extension => StreamLanguage.define(parser)

const LOADERS: Record<LanguageKey, (() => Promise<Extension>) | null> = {
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  typescript: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  jsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  tsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true, typescript: true })),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  markdown: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  python: () => import('@codemirror/lang-python').then((m) => m.python()),
  xml: () => import('@codemirror/lang-xml').then((m) => m.xml()),
  yaml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  csharp: () => import('@codemirror/legacy-modes/mode/clike').then((m) => [legacy(m.csharp), braceFolding]),
  shell: () => import('@codemirror/legacy-modes/mode/shell').then((m) => legacy(m.shell)),
  powershell: () => import('@codemirror/legacy-modes/mode/powershell').then((m) => legacy(m.powerShell)),
  plain: null
}

export async function loadLanguage(path: string): Promise<Extension | null> {
  const load = LOADERS[languageKey(path)]
  if (!load) return null
  try {
    return await load()
  } catch (err) {
    console.warn('[files] language load failed', path, err)
    return null
  }
}
