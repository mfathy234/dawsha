// Names a file's language without pulling CodeMirror into the main bundle.
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
