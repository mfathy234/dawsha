import { describe, expect, it } from 'vitest'
import { buildScopes, classifyConfigFile, readConfigText, resolveRow, revealConfigValue, type ConfigFile } from '../../src/shared/configFiles'
import { parseDotenv, parseJsonConfig } from '../../src/shared/configParse'
import { isSecretConfig, secretKeyName, secretValueShape } from '../../src/shared/configSecrets'

const info = (name: string) => classifyConfigFile(name) as NonNullable<ReturnType<typeof classifyConfigFile>>
const file = (path: string, text: string): ConfigFile => readConfigText(path, info(path.split('/').pop() as string), text)

describe('classifyConfigFile', () => {
  it('recognises the config files and their environments', () => {
    expect(classifyConfigFile('appsettings.json')).toEqual({ kind: 'appsettings', environment: null, local: false })
    expect(classifyConfigFile('appsettings.Production.json')).toEqual({ kind: 'appsettings', environment: 'Production', local: false })
    expect(classifyConfigFile('launchSettings.json')?.kind).toBe('launch')
    expect(classifyConfigFile('.env')).toEqual({ kind: 'env', environment: null, local: false })
    expect(classifyConfigFile('.env.local')).toEqual({ kind: 'env', environment: null, local: true })
    expect(classifyConfigFile('.env.staging.local')).toEqual({ kind: 'env', environment: 'staging', local: true })
    expect(classifyConfigFile('local.settings.json')?.kind).toBe('appsettings')
    expect(classifyConfigFile('package.json')).toBeNull()
    expect(classifyConfigFile('appsettings.json.bak')).toBeNull()
  })
})

describe('parseJsonConfig', () => {
  it('flattens sections and arrays and records the line of each key', () => {
    const flat = parseJsonConfig('{\n  "Logging": {\n    "Level": "Info"\n  },\n  "Hosts": ["a", "b"],\n  "Port": 80, "On": true, "Nothing": null\n}')
    expect(flat).toEqual([
      { key: 'Logging:Level', value: 'Info', line: 3 },
      { key: 'Hosts:0', value: 'a', line: 5 },
      { key: 'Hosts:1', value: 'b', line: 5 },
      { key: 'Port', value: '80', line: 6 },
      { key: 'On', value: 'true', line: 6 },
      { key: 'Nothing', value: 'null', line: 6 }
    ])
  })

  it('allows comments and trailing commas like .NET does, and keeps lines right after them', () => {
    const flat = parseJsonConfig('// top\n{\n  /* block\n  comment */\n  "A": "x", // tail\n  "B": "y",\n}\n')
    expect(flat.map((item) => [item.key, item.line])).toEqual([['A', 5], ['B', 6]])
  })

  it('does not treat // inside a string as a comment', () => {
    expect(parseJsonConfig('{"Url": "http://x/y"}')[0].value).toBe('http://x/y')
  })

  it('reports where malformed JSON breaks', () => {
    expect(() => parseJsonConfig('{\n  "A": 1\n  "B": 2\n}')).toThrow(/Expected/)
    try {
      parseJsonConfig('{\n  "A": 1\n  "B": 2\n}')
    } catch (error) {
      expect((error as { line: number }).line).toBe(3)
    }
    expect(() => parseJsonConfig('{ "A": ')).toThrow()
    expect(() => parseJsonConfig('{ /* open')).toThrow(/never closed/)
    expect(() => parseJsonConfig('{} extra')).toThrow(/Unexpected text/)
  })

  it('refuses absurd nesting', () => {
    expect(() => parseJsonConfig('['.repeat(200))).toThrow(/too deep/)
  })
})

describe('parseDotenv', () => {
  it('reads export, quotes, comments and multi-line values', () => {
    const flat = parseDotenv('# c\nA=1\nexport B="two words"\nC=x # note\nD=\'single # kept\'\nE="line1\nline2"\nF=last\n')
    expect(flat.map((item) => [item.key, item.value, item.line])).toEqual([
      ['A', '1', 2], ['B', 'two words', 3], ['C', 'x', 4], ['D', 'single # kept', 5], ['E', 'line1\nline2', 6], ['F', 'last', 8]
    ])
  })

  it('names an unclosed quote', () => {
    expect(() => parseDotenv('A="never')).toThrow(/never closed/)
  })
})

describe('secret detection', () => {
  it('masks by key name', () => {
    for (const key of ['Password', 'DB_PASSWORD', 'ApiKey', 'Jwt:Secret', 'ConnectionStrings:Default', 'GITHUB_TOKEN', 'PrimaryKey', 'client_secret', 'AuthToken'])
      expect(secretKeyName(key), key).toBe(true)
    for (const key of ['Logging:Level', 'Port', 'Keyboard', 'AllowedHosts', 'Monkey', 'applicationUrl']) expect(secretKeyName(key), key).toBe(false)
  })

  it('masks by value shape whatever the key', () => {
    expect(secretValueShape('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456')).toBe(true)
    expect(secretValueShape('ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(true)
    expect(secretValueShape('Server=db;User Id=sa;Password=hunter2;')).toBe(true)
    expect(secretValueShape('postgres://user:pw@host/db')).toBe(true)
    expect(secretValueShape('0123456789abcdef0123456789abcdef01234567')).toBe(true)
    expect(secretValueShape('http://localhost:5000')).toBe(false)
    expect(secretValueShape('Information')).toBe(false)
    expect(secretValueShape('a normal sentence of text here')).toBe(false)
  })

  it('combines both', () => {
    expect(isSecretConfig('Anything', 'AKIAABCDEFGHIJKLMNOP')).toBe(true)
    expect(isSecretConfig('Mode', 'dev')).toBe(false)
  })
})

describe('readConfigText', () => {
  it('never carries a masked value', () => {
    const read = file('appsettings.json', '{\n "Db": {"Password": "hunter2"},\n "Mode": "dev"\n}')
    const secret = read.entries.find((entry) => entry.key === 'Db:Password')
    expect(secret).toEqual({ key: 'Db:Password', value: null, masked: true, line: 2 })
    expect(JSON.stringify(read)).not.toContain('hunter2')
    expect(read.entries.find((entry) => entry.key === 'Mode')?.value).toBe('dev')
  })

  it('turns a parse failure into a per-file message', () => {
    const read = file('appsettings.json', '{ "A": }')
    expect(read.entries).toEqual([])
    expect(read.error).toMatch(/Expected a value\. Line 1/)
  })

  it('reads launch profiles', () => {
    const text = '{\n "profiles": {\n  "Api": {\n   "applicationUrl": "https://localhost:5001",\n   "environmentVariables": {\n    "ASPNETCORE_ENVIRONMENT": "Development",\n    "Jwt__Secret": "abc"\n   }\n  }\n }\n}'
    const read = file('Properties/launchSettings.json', text)
    expect(read.entries.map((entry) => [entry.key, entry.profile, entry.masked])).toEqual([
      ['applicationUrl', 'Api', false], ['ASPNETCORE_ENVIRONMENT', 'Api', false], ['Jwt__Secret', 'Api', true]
    ])
  })
})

describe('revealConfigValue', () => {
  it('returns the value at the key and line, and null when the file moved on', () => {
    const text = '{\n "Db": {"Password": "hunter2"}\n}'
    expect(revealConfigValue(info('appsettings.json'), text, 'Db:Password', 2)).toBe('hunter2')
    expect(revealConfigValue(info('appsettings.json'), text, 'Db:Password', 3)).toBeNull()
    expect(revealConfigValue(info('appsettings.json'), '{ broken', 'Db:Password', 2)).toBeNull()
    expect(revealConfigValue(info('.env'), 'TOKEN=abc\n', 'TOKEN', 1)).toBe('abc')
  })
})

describe('precedence', () => {
  const files = [
    file('api/appsettings.json', '{"Logging": {"Level": "Info"}, "Port": 80}'),
    file('api/appsettings.Production.json', '{"Logging": {"Level": "Warn"}}'),
    file('api/appsettings.Development.json', '{"Logging": {"Level": "Debug"}}'),
    file('api/.env', 'LOGGING__LEVEL=Trace\nPORT=1'),
    file('web/.env', 'PORT=3000')
  ]
  const scopes = buildScopes(files)
  const api = scopes.find((scope) => scope.dir === 'api')!
  const level = api.rows.find((row) => row.key === 'Logging:Level')!

  it('keeps folders apart and lists the environments seen', () => {
    expect(scopes.map((scope) => scope.dir)).toEqual(['api', 'web'])
    expect(api.environments).toEqual(['Development', 'Production'])
  })

  it('lets the environment file beat the base file, and a .env beat both, matching __ with :', () => {
    expect(level.sources.map((source) => source.path)).toEqual(['api/appsettings.json', 'api/appsettings.Production.json', 'api/appsettings.Development.json', 'api/.env'])
    expect(resolveRow(level, 'Production').winner?.value).toBe('Trace')
    expect(resolveRow(level, 'Production').overridden).toHaveLength(2)
  })

  it('applies only the base to the base environment', () => {
    const port = api.rows.find((row) => row.key === 'Port')!
    expect(resolveRow(port, null).winner?.path).toBe('api/.env')
    const noEnv = buildScopes([file('a/appsettings.json', '{"X": 1}'), file('a/appsettings.Production.json', '{"X": 2}')])[0].rows[0]
    expect(resolveRow(noEnv, null).winner?.value).toBe('1')
    expect(resolveRow(noEnv, 'production').winner?.value).toBe('2')
  })

  it('applies a launch profile to the environment it sets', () => {
    const launch = file('api/Properties/launchSettings.json', '{"profiles":{"P":{"environmentVariables":{"ASPNETCORE_ENVIRONMENT":"Development","Logging__Level":"Critical"}}}}')
    const merged = buildScopes([...files.slice(0, 3), launch])[0]
    const row = merged.rows.find((item) => item.key === 'Logging__Level' || item.key === 'Logging:Level')!
    expect(resolveRow(row, 'Development').winner?.value).toBe('Critical')
    expect(resolveRow(row, 'Production').winner?.value).toBe('Warn')
  })
})
