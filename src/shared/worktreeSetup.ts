export interface WorktreeSetupCommand { label: string; command: string }
export type WorktreeSetupInspectResult = { ok: true; exists: boolean; patterns: string; suggestions: string[]; commands: WorktreeSetupCommand[] } | { ok: false; error: string }
export interface SetupFile { path: string; content?: string }

export const WORKTREE_SKIP_DIRS = ['node_modules', 'bin', 'obj', 'dist', 'build', '.venv', 'venv', 'target', 'vendor', '.git'] as const
const skipped = new Set<string>(WORKTREE_SKIP_DIRS)

/** Repository-relative paths only. Build/dependency trees are never part of local-file copying. */
export function isWorktreeLocalPath(path: string): boolean {
  return path !== '' && !path.includes('\0') && !path.includes('\\') && !path.startsWith('/') && !/^[a-z]:/i.test(path) && !path.split('/').some((part) => part === '..' || part === '.' || part === '' || skipped.has(part.toLowerCase()))
}

export function parseWorktreeInclude(text: string): string[] {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.replace(/(?<!\\) +$/, '')).filter((line) => line !== '' && !line.startsWith('#'))
}

function globRegex(pattern: string): RegExp {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '\\' && index + 1 < pattern.length) {
      source += pattern[++index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    } else if (char === '*') {
      if (pattern[index + 1] === '*' && (index === 0 || pattern[index - 1] === '/') && (index + 2 === pattern.length || pattern[index + 2] === '/')) {
        index += 1
        if (pattern[index + 1] === '/') { source += '(?:[^/]+/)*'; index += 1 } else source += '.*'
      } else source += '[^/]*'
    } else if (char === '?') source += '[^/]'
    else if (char === '[') {
      const end = pattern.indexOf(']', index + 1)
      if (end > index + 1) {
        const range = pattern.slice(index + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')
        source += `[${range}]`; index = end
      } else source += '\\['
    } else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(source)
}

export function matchesWorktreeInclude(path: string, rules: readonly string[]): boolean {
  if (!isWorktreeLocalPath(path)) return false
  let included = false
  for (const rule of rules) {
    const negate = rule.startsWith('!')
    const raw = negate ? rule.slice(1) : rule
    if (!raw) continue
    const anchored = raw.startsWith('/')
    const pattern = raw.replace(/^\//, '').replace(/\/$/, '')
    if (!pattern) continue
    try {
      const prefix = anchored || pattern.includes('/') ? '^' : '(?:^|/)'
      const suffix = raw.endsWith('/') ? '/' : '(?:/|$)'
      if (new RegExp(`${prefix}${globRegex(pattern).source}${suffix}`).test(path)) included = !negate
    } catch { /* Invalid character ranges cannot select a file. */ }
  }
  return included
}

export function suggestLocalFiles(paths: readonly string[]): string[] {
  return [...new Set(paths.filter((path) => {
    if (!isWorktreeLocalPath(path) || /\.(?:pem|key)$/i.test(path)) return false
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (/^\.env\.example(?:\.|$)/i.test(name)) return false
    return /^\.env(?:\..+)?$/.test(name) || /\.local$/i.test(name) || /^appsettings\..+\.json$/i.test(name) || /^(?:local\.settings\.json|secrets\.json|\.npmrc|\.yarnrc\.yml|docker-compose\.override\.yml)$/i.test(name) || /(?:^|\/)config\/[^/]+\.local\.[^/]+$/i.test(path) || /(?:^|\/)\.vscode\/settings\.json$/i.test(path)
  }))].sort()
}

/** All commands are editable suggestions; no repository comment is interpreted as a command. */
export function detectSetupCommands(files: readonly SetupFile[]): WorktreeSetupCommand[] {
  const byDirectory = new Map<string, Map<string, string>>()
  const paths = new Set(files.map((file) => file.path))
  for (const file of files) {
    const slash = file.path.lastIndexOf('/')
    const directory = slash < 0 ? '' : file.path.slice(0, slash)
    if (/[\r\n"`$&|<>%!^()]/.test(directory) || directory.split('/').includes('..')) continue
    const entries = byDirectory.get(directory) ?? new Map<string, string>()
    entries.set(file.path.slice(slash + 1), file.content ?? '')
    byDirectory.set(directory, entries)
  }
  const solutions = [...byDirectory].filter(([, entries]) => [...entries.keys()].some((name) => /\.slnx?$/i.test(name))).map(([directory]) => directory)
  const commands: WorktreeSetupCommand[] = []
  for (const [directory, entries] of [...byDirectory].sort(([a], [b]) => a.localeCompare(b))) {
    const add = (label: string, command: string): void => { commands.push({ label: directory ? `${label} (${directory})` : label, command: directory ? `cd "${directory}" && ${command}` : command }) }
    if (entries.has('package-lock.json') || entries.has('npm-shrinkwrap.json')) add('npm', 'npm ci')
    else if (entries.has('pnpm-lock.yaml')) add('pnpm', 'pnpm install --frozen-lockfile')
    else if (entries.has('yarn.lock')) {
      let version = 1
      try { version = Number.parseInt(JSON.parse(entries.get('package.json') ?? '{}').packageManager?.match(/^yarn@(\d+)/)?.[1] ?? '1', 10) } catch { /* A malformed manifest still allows the lockfile suggestion. */ }
      if (/yarnPath:.*yarn-[2-9]/.test(entries.get('.yarnrc.yml') ?? '')) version = 2
      add('Yarn', version >= 2 ? 'yarn install --immutable' : 'yarn install --frozen-lockfile')
    } else if (entries.has('bun.lockb') || entries.has('bun.lock')) add('Bun', 'bun install')
    else if (entries.has('package.json')) add('npm', 'npm install')
    const hasSolution = [...entries.keys()].some((name) => /\.slnx?$/i.test(name))
    if (hasSolution || ([...entries.keys()].some((name) => /\.[cfv]sproj$/i.test(name)) && !solutions.some((parent) => parent === '' || directory.startsWith(`${parent}/`)))) add('.NET', 'dotnet restore')
    if (entries.has('uv.lock')) add('uv', 'uv sync')
    else if (entries.has('poetry.lock')) add('Poetry', 'poetry install')
    else if (entries.has('Pipfile.lock')) add('Pipenv', 'pipenv install --deploy')
    else if (entries.has('requirements.txt')) {
      const prefix = directory ? `${directory}/` : ''
      const environment = ['.venv/Scripts/python.exe', 'venv/Scripts/python.exe', '.venv/bin/python', 'venv/bin/python'].find((path) => paths.has(`${prefix}${path}`))
      const pip = environment ? `${environment.includes('/Scripts/') ? environment.replace(/\//g, '\\') : `./${environment}`} -m pip` : 'pip'
      const create = environment ? `${environment.includes('/Scripts/') ? 'python' : 'python3'} -m venv ${environment.split('/')[0]} && ` : ''
      add(environment ? 'pip (new virtual environment)' : 'pip', `${create}${pip} install -r requirements.txt`)
    }
    if (entries.has('Cargo.lock')) add('Cargo', 'cargo fetch')
    if (entries.has('go.sum')) add('Go', 'go mod download')
    if (entries.has('Gemfile.lock')) add('Ruby', 'bundle install')
    if (entries.has('composer.lock')) add('PHP', 'composer install')
    if (entries.has('pubspec.lock')) add(/sdk:\s*flutter/.test(entries.get('pubspec.yaml') ?? '') ? 'Flutter' : 'Dart', /sdk:\s*flutter/.test(entries.get('pubspec.yaml') ?? '') ? 'flutter pub get' : 'dart pub get')
    if (entries.has('gradlew')) add('Gradle', './gradlew --version')
    if (entries.has('pom.xml')) add('Maven', 'mvn -q dependency:go-offline')
  }
  return commands
}
