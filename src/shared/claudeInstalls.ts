// Pure logic for finding out how an existing Claude Code was installed and what Dawsha may safely do to it.
// Detection (file system, PATH, login shell) lives in src/main/claudeInstalls.ts.

export type InstallKind = 'native' | 'npm'

export interface ClaudeInstall {
  /** The file `claude` resolves to for this install (a shim for npm installs on Windows). */
  path: string
  kind: InstallKind
  /** npm global prefix that owns the install (npm kind only, null when unknown or a legacy local install). */
  npmPrefix: string | null
  /** The old `~/.claude/local` npm install; only `claude update` can migrate it. */
  legacyLocal: boolean
  /** True when a plain `claude` typed in a terminal reaches this install. */
  onPath: boolean
  version: string | null
}

export interface ClassifyInput {
  path: string
  /** The path after following symlinks. */
  realPath?: string | null
  /** The text of a small shim file (claude.cmd, claude.ps1, an sh wrapper). */
  shim?: string | null
}

export interface Classified {
  kind: InstallKind
  npmPrefix: string | null
  legacyLocal: boolean
}

const PACKAGE_DIR = /^(.*?)[\\/]node_modules[\\/]@anthropic-ai[\\/]claude-code(?:[\\/]|$)/i
const PACKAGE_MENTION = /node_modules[\\/]+@anthropic-ai[\\/]+claude-code/i
const LEGACY_LOCAL = /[\\/]\.claude[\\/]local(?:[\\/]|$)/i
const NPM_LIKE_DIR = /[\\/](?:\.?volta|shims)[\\/]/i
const SHIM_EXTENSION = /\.(cmd|bat|ps1)$/i

const dirOf = (path: string): string => {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return cut > 0 ? path.slice(0, cut) : path
}

const baseOf = (path: string): string => path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1)

/** `<prefix>/lib/node_modules/...` on macOS and Linux, `<prefix>\node_modules\...` on Windows. */
function prefixFromPackageDir(parent: string): string {
  return baseOf(parent).toLowerCase() === 'lib' ? dirOf(parent) : parent
}

export function classifyClaudeInstall(input: ClassifyInput): Classified {
  const real = input.realPath ?? input.path
  const inPackage = PACKAGE_DIR.exec(real) ?? PACKAGE_DIR.exec(input.path)
  if (inPackage) {
    const legacy = LEGACY_LOCAL.test(real) || LEGACY_LOCAL.test(input.path)
    return { kind: 'npm', npmPrefix: legacy ? null : prefixFromPackageDir(inPackage[1]), legacyLocal: legacy }
  }
  if (input.shim && PACKAGE_MENTION.test(input.shim)) {
    const legacy = LEGACY_LOCAL.test(input.path)
    return { kind: 'npm', npmPrefix: legacy ? null : dirOf(input.path), legacyLocal: legacy }
  }
  if (LEGACY_LOCAL.test(input.path)) return { kind: 'npm', npmPrefix: null, legacyLocal: true }
  if (SHIM_EXTENSION.test(input.path) || NPM_LIKE_DIR.test(input.path)) {
    return { kind: 'npm', npmPrefix: null, legacyLocal: false }
  }
  return { kind: 'native', npmPrefix: null, legacyLocal: false }
}

export function claudeInstallKind(path: string | null): InstallKind | null {
  return path === null ? null : classifyClaudeInstall({ path }).kind
}

const normalizePrefix = (value: string): string => value.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()

export function samePrefix(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a) && Boolean(b) && normalizePrefix(a as string) === normalizePrefix(b as string)
}

const quote = (value: string): string => `"${value}"`

/** `npm install -g` for a package, aimed at the prefix that owns the existing install when it is not npm's default. */
export function npmInstallCommand(pkg: string, ownerPrefix: string | null, defaultPrefix: string | null): string {
  const target = ownerPrefix && defaultPrefix && !samePrefix(ownerPrefix, defaultPrefix) ? ` --prefix ${quote(ownerPrefix)}` : ''
  return `npm install -g${target} ${pkg}@latest`
}

export interface ConflictNotice {
  title: string
  /** Which installs exist and which one `claude` reaches. */
  lines: string[]
  /** Commands the user can run themselves, per Anthropic's "Check for conflicting installations". */
  fix: string[]
}

const describeInstall = (install: ClaudeInstall): string =>
  `${install.path} - ${install.kind === 'npm' ? 'npm install' : 'native install'}, ${install.version ?? 'version unknown'}`

function removalCommands(install: ClaudeInstall): string[] {
  if (install.kind === 'npm') {
    if (install.legacyLocal) {
      return install.path.includes('\\') ? ['Remove-Item -Recurse -Force "$env:USERPROFILE\\.claude\\local"'] : ['rm -rf ~/.claude/local']
    }
    const prefix = install.npmPrefix ? ` --prefix ${quote(install.npmPrefix)}` : ''
    return [`npm uninstall -g${prefix} @anthropic-ai/claude-code`]
  }
  return install.path.includes('\\')
    ? [
        'Remove-Item -Path "$env:USERPROFILE\\.local\\bin\\claude.exe" -Force',
        'Remove-Item -Path "$env:USERPROFILE\\.local\\share\\claude" -Recurse -Force'
      ]
    : ['rm -f ~/.local/bin/claude', 'rm -rf ~/.local/share/claude']
}

export function claudeConflict(installs: readonly ClaudeInstall[] | undefined): ConflictNotice | null {
  if (!installs || installs.length < 2) return null
  const reached = installs.find((install) => install.onPath)
  const lines = [
    reached ? `Typing claude runs: ${reached.path}` : 'Typing claude finds none of them on your PATH.',
    ...installs.map((install) => `Found: ${describeInstall(install)}`)
  ]
  const keep = installs.find((install) => install.kind === 'native') ?? installs[0]
  const fix = installs.filter((install) => install !== keep).flatMap(removalCommands)
  return {
    title: 'Two Claude Code installs found',
    lines,
    fix
  }
}
