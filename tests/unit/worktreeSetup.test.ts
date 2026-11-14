import { describe, expect, it } from 'vitest'
import { detectSetupCommands, matchesWorktreeInclude, parseWorktreeInclude, suggestLocalFiles } from '../../src/shared/worktreeSetup'

describe('worktree include patterns', () => {
  it('handles comments, globs, negation, root anchors, directories and escaped markers', () => {
    const rules = parseWorktreeInclude('# local files\r\n.env*\n!.env.example\n/config/*.local.*\nprivate/\n!private/skip.json\n\\#literal\n\\!literal\n')
    expect(['.env', 'api/.env.dev', 'config/dev.local.json', 'private/sub/settings.json', '#literal', '!literal'].map((p) => matchesWorktreeInclude(p, rules))).toEqual([true, true, true, true, true, true])
    expect(['.env.example', 'api/.env.example', 'api/config/dev.local.json', 'private/skip.json', 'README.md'].map((p) => matchesWorktreeInclude(p, rules))).toEqual([false, false, false, false, false])
  })
  it('supports globstars, single-character wildcards and character classes', () => {
    const rules = parseWorktreeInclude('config/**/local?.[jy]son\n')
    expect(matchesWorktreeInclude('config/local1.json', rules)).toBe(true)
    expect(matchesWorktreeInclude('config/nested/local2.yson', rules)).toBe(true)
    expect(matchesWorktreeInclude('config/local12.json', rules)).toBe(false)
  })
  it('keeps directory-only patterns from selecting a file with the same name', () => {
    const rules = parseWorktreeInclude('private/\n')
    expect(matchesWorktreeInclude('private/settings.json', rules)).toBe(true)
    expect(matchesWorktreeInclude('private', rules)).toBe(false)
  })
  it('refuses traversal and absolute paths even when a wildcard matches', () => {
    const rules = parseWorktreeInclude('**')
    for (const path of ['../outside', '/outside', 'C:/outside', 'a/../../outside', '.git/config', 'node_modules/.env']) expect(matchesWorktreeInclude(path, rules)).toBe(false)
  })
})

describe('local config suggestions', () => {
  it('suggests ignored local configuration across stacks but excludes examples, dependency trees and private keys', () => {
    expect(suggestLocalFiles(['.env', 'api/.env.dev', '.env.example', '.env.example.local', 'user.local', 'appsettings.user.json', 'api/appsettings.Development.json', 'local.settings.json', 'secrets.json', '.npmrc', '.yarnrc.yml', 'config/db.local.json', 'docker-compose.override.yml', '.vscode/settings.json', 'cert.pem', 'private.key', 'node_modules/a/.env', 'src/main.ts'])).toEqual(['.env', '.npmrc', '.vscode/settings.json', '.yarnrc.yml', 'api/.env.dev', 'api/appsettings.Development.json', 'appsettings.user.json', 'config/db.local.json', 'docker-compose.override.yml', 'local.settings.json', 'secrets.json', 'user.local'])
  })
})

describe('setup command detection', () => {
  const fixtures: Array<[string, string[], string]> = [
    ['npm', ['package.json', 'package-lock.json', 'yarn.lock'], 'npm ci'],
    ['pnpm', ['package.json', 'pnpm-lock.yaml'], 'pnpm install --frozen-lockfile'],
    ['Yarn modern', ['yarn.lock', 'package.json'], 'yarn install --immutable'],
    ['Yarn classic', ['yarn.lock'], 'yarn install --frozen-lockfile'],
    ['Bun', ['bun.lockb'], 'bun install'],
    ['.NET', ['App.sln', 'App.csproj'], 'dotnet restore'],
    ['pip', ['requirements.txt'], 'pip install -r requirements.txt'],
    ['uv', ['requirements.txt', 'uv.lock'], 'uv sync'],
    ['Poetry', ['poetry.lock'], 'poetry install'],
    ['Pipenv', ['Pipfile.lock'], 'pipenv install --deploy'],
    ['Cargo', ['Cargo.lock'], 'cargo fetch'],
    ['Go', ['go.sum'], 'go mod download'],
    ['Ruby', ['Gemfile.lock'], 'bundle install'],
    ['PHP', ['composer.lock'], 'composer install'],
    ['Flutter', ['pubspec.lock', 'pubspec.yaml'], 'flutter pub get'],
    ['Dart', ['pubspec.lock'], 'dart pub get'],
    ['Gradle', ['gradlew'], './gradlew --version'],
    ['Maven', ['pom.xml'], 'mvn -q dependency:go-offline']
  ]
  it.each(fixtures)('detects %s with its lockfile preference', (label, paths, expected) => {
    const entries = paths.map((path) => ({ path, content: path === 'package.json' ? '{"packageManager":"yarn@4.5.0"}' : path === 'pubspec.yaml' ? 'dependencies:\n  flutter:\n    sdk: flutter' : '' }))
    expect(detectSetupCommands(entries).map((item) => item.command)).toEqual([expected])
  })
  it('uses the existing virtual environment for pip', () => {
    expect(detectSetupCommands([{ path: 'requirements.txt' }, { path: '.venv/Scripts/python.exe' }])[0].command).toBe('python -m venv .venv && .venv\\Scripts\\python.exe -m pip install -r requirements.txt')
    expect(detectSetupCommands([{ path: 'requirements.txt' }, { path: 'venv/bin/python' }])[0].command).toBe('python3 -m venv venv && ./venv/bin/python -m pip install -r requirements.txt')
  })
  it('offers each nested stack in a monorepo, avoiding duplicate dotnet restores under a solution', () => {
    expect(detectSetupCommands([{ path: 'api/App.sln' }, { path: 'api/src/App.csproj' }, { path: 'web/pnpm-lock.yaml' }, { path: 'worker/uv.lock' }]).map((item) => item.command)).toEqual(['cd "api" && dotnet restore', 'cd "web" && pnpm install --frozen-lockfile', 'cd "worker" && uv sync'])
  })
})
