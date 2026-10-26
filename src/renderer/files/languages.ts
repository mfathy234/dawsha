import type { Extension } from '@codemirror/state'
import { StreamLanguage, type StreamParser } from '@codemirror/language'

export type LanguageKey =
  | 'javascript' | 'typescript' | 'jsx' | 'tsx' | 'json' | 'markdown' | 'css' | 'html' | 'python'
  | 'xml' | 'yaml' | 'sql' | 'csharp' | 'shell' | 'powershell' | 'plain'

const BY_EXTENSION: Record<string, LanguageKey> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', mts: 'typescript', cts: 'typescript',
  jsx: 'jsx', tsx: 'tsx', json: 'json', jsonc: 'json', md: 'markdown', markdown: 'markdown', css: 'css',
  html: 'html', htm: 'html', py: 'python', xml: 'xml', svg: 'xml', csproj: 'xml', yml: 'yaml', yaml: 'yaml',
  sql: 'sql', cs: 'csharp', sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', psm1: 'powershell'
}

const BY_NAME: Record<string, LanguageKey> = { dockerfile: 'shell', '.bashrc': 'shell', '.zshrc': 'shell', '.babelrc': 'json' }

const LABELS: Record<LanguageKey, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', jsx: 'JSX', tsx: 'TSX', json: 'JSON', markdown: 'Markdown', css: 'CSS',
  html: 'HTML', python: 'Python', xml: 'XML', yaml: 'YAML', sql: 'SQL', csharp: 'C#', shell: 'Shell', powershell: 'PowerShell', plain: 'Plain text'
}

export const languageLabel = (path: string): string => LABELS[languageKey(path)]

export function languageKey(path: string): LanguageKey {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (BY_NAME[name]) return BY_NAME[name]
  const dot = name.lastIndexOf('.')
  if (dot < 0) return 'plain'
  return BY_EXTENSION[name.slice(dot + 1)] ?? 'plain'
}

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
  csharp: () => import('@codemirror/legacy-modes/mode/clike').then((m) => legacy(m.csharp)),
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
