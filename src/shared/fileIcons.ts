// The small set of file-type icons for the Files tree and tabs: a short monochrome glyph per type, coloured by its kind
// in fileIcons.css (a lighter shade on dark themes, a darker one on light themes).

export type FileIconKind =
  | 'ts' | 'tsx' | 'js' | 'jsx' | 'json' | 'md' | 'css' | 'scss' | 'html' | 'py' | 'cs' | 'shell' | 'ps' | 'yaml' | 'xml'
  | 'sql' | 'image' | 'lock' | 'git' | 'env' | 'text' | 'config' | 'file'

export interface FileIconSpec {
  kind: FileIconKind
  glyph: string
}

const SPECS: Record<FileIconKind, string> = {
  ts: 'TS', tsx: 'TS', js: 'JS', jsx: 'JS', json: '{}', md: 'M↓', css: '#', scss: '#', html: '<>', py: 'Py', cs: 'C#', shell: 'sh', ps: 'PS',
  yaml: 'Y', xml: '<>', sql: 'DB', image: 'Im', lock: 'Lk', git: 'Gi', env: 'En', text: 'Tx', config: 'Cf', file: '≡'
}

const BY_EXTENSION: Record<string, FileIconKind> = {
  ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx', js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', json: 'json', jsonc: 'json', json5: 'json',
  md: 'md', markdown: 'md', mdx: 'md', css: 'css', scss: 'scss', sass: 'scss', less: 'css', html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  py: 'py', cs: 'cs', csx: 'cs', razor: 'cs', cshtml: 'cs', sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'ps', psm1: 'ps', psd1: 'ps',
  yml: 'yaml', yaml: 'yaml', xml: 'xml', csproj: 'xml', props: 'xml', targets: 'xml', xaml: 'xml', svg: 'image', sql: 'sql',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', ico: 'image', icns: 'image',
  lock: 'lock', env: 'env', txt: 'text', log: 'text', toml: 'config', ini: 'config', cfg: 'config', conf: 'config', sln: 'config', gradle: 'config'
}

const BY_NAME: Record<string, FileIconKind> = {
  '.gitignore': 'git', '.gitattributes': 'git', '.gitmodules': 'git', '.env': 'env', '.editorconfig': 'config', dockerfile: 'config',
  'package.json': 'json', 'package-lock.json': 'lock', 'yarn.lock': 'lock', 'pnpm-lock.yaml': 'lock', license: 'text', makefile: 'config'
}

export function fileIconFor(path: string): FileIconSpec {
  const name = (path.split(/[\\/]/).pop() ?? '').toLowerCase()
  const dot = name.lastIndexOf('.')
  const kind = BY_NAME[name] ?? (name.startsWith('.env') ? 'env' : dot > 0 ? BY_EXTENSION[name.slice(dot + 1)] ?? 'file' : 'file')
  return { kind, glyph: SPECS[kind] }
}
