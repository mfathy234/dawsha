import { ConfigParseError, parseDotenv, parseJsonConfig, type FlatSetting } from './configParse'
import { isSecretConfig } from './configSecrets'

export type ConfigKind = 'appsettings' | 'launch' | 'env'

export interface ConfigFileInfo {
  kind: ConfigKind
  /** The environment a file is for (Development in appsettings.Development.json), or null for the base file. */
  environment: string | null
  /** A .local file overrides its sibling for the same environment. */
  local: boolean
}

export interface ConfigEntry {
  key: string
  /** Null when the value is masked: the real value is only fetched when the user asks for it. */
  value: string | null
  masked: boolean
  line: number
  /** The launch profile an entry belongs to. */
  profile?: string
}

export interface ConfigFile extends ConfigFileInfo {
  path: string
  entries: ConfigEntry[]
  error: string | null
}

export interface ConfigSource {
  path: string
  line: number
  environment: string | null
  value: string | null
  masked: boolean
  rank: number
  profile?: string
}

export interface ConfigRow {
  key: string
  sources: ConfigSource[]
}

export interface ConfigScope {
  dir: string
  environments: string[]
  rows: ConfigRow[]
}

export interface RowResolution {
  winner: ConfigSource | null
  overridden: ConfigSource[]
}

export type ConfigReport = { ok: true; files: ConfigFile[] } | { ok: false; error: string }
export type ConfigRevealResult = { ok: true; value: string } | { ok: false; error: string }

export interface ConfigRevealRequest {
  folder: string
  path: string
  key: string
  line: number
}

const APPSETTINGS = /^appsettings(?:\.(.+?))?\.json$/i
const LOCAL_SETTINGS = /^local\.settings(?:\.(.+?))?\.json$/i
const DOTENV = /^\.env(?:\.(.+?))?$/i
const NAMED_ENV = /^(.+)\.env$/i
const LAUNCH_VARIABLE = /^profiles:([^:]+):environmentVariables:(.+)$/
const LAUNCH_SETTING = /^profiles:([^:]+):(applicationUrl|commandLineArgs|launchUrl)$/
const ENVIRONMENT_VARIABLES = new Set(['ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT'])

/** What a project file is for, or null when it is not a config file. Takes the file name only. */
export function classifyConfigFile(name: string): ConfigFileInfo | null {
  const settings = APPSETTINGS.exec(name) ?? LOCAL_SETTINGS.exec(name)
  if (settings) return { kind: 'appsettings', environment: settings[1] ?? null, local: LOCAL_SETTINGS.test(name) }
  if (/^launchSettings\.json$/i.test(name)) return { kind: 'launch', environment: null, local: false }
  const dotenv = DOTENV.exec(name)
  if (dotenv) {
    const rest = dotenv[1] ?? ''
    return { kind: 'env', environment: rest.replace(/(^|\.)local$/i, '') || null, local: /(^|\.)local$/i.test(rest) }
  }
  const named = NAMED_ENV.exec(name)
  return named ? { kind: 'env', environment: named[1], local: false } : null
}

function makeEntry(key: string, value: string, line: number, profile?: string): ConfigEntry {
  const masked = isSecretConfig(key, value)
  return { key, value: masked ? null : value, masked, line, ...(profile ? { profile } : {}) }
}

function launchEntries(flat: readonly FlatSetting[]): ConfigEntry[] {
  const out: ConfigEntry[] = []
  for (const item of flat) {
    const variable = LAUNCH_VARIABLE.exec(item.key)
    const setting = LAUNCH_SETTING.exec(item.key)
    if (variable) out.push(makeEntry(variable[2], item.value, item.line, variable[1]))
    else if (setting) out.push(makeEntry(setting[2], item.value, item.line, setting[1]))
  }
  return out
}

function flatten(kind: ConfigKind, text: string): FlatSetting[] {
  return kind === 'env' ? parseDotenv(text) : parseJsonConfig(text)
}

/** Reads one config file's text into entries, or the reason it cannot be read. Secret values are masked here, so they stay in the main process until asked for. */
export function readConfigText(path: string, info: ConfigFileInfo, text: string): ConfigFile {
  try {
    const flat = flatten(info.kind, text)
    const entries = info.kind === 'launch' ? launchEntries(flat) : flat.map((item) => makeEntry(item.key, item.value, item.line))
    return { ...info, path, entries, error: null }
  } catch (error) {
    if (!(error instanceof ConfigParseError)) throw error
    return { ...info, path, entries: [], error: `${error.message} Line ${error.line}, column ${error.column}.` }
  }
}

/** The value of one key at one line, for when the user clicks a masked value. Null when the file changed since it was listed. */
export function revealConfigValue(info: ConfigFileInfo, text: string, key: string, line: number): string | null {
  try {
    const flat = flatten(info.kind, text)
    return flat.find((item) => item.line === line && (item.key === key || item.key.endsWith(`:${key}`)))?.value ?? null
  } catch {
    return null
  }
}

const normalKey = (key: string): string => key.replace(/__/g, ':').toLowerCase()
const sameName = (a: string | null, b: string | null): boolean => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()
const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
/** launchSettings.json lives in Properties/ beside the project, so it belongs with the project's appsettings. */
const scopeDir = (file: ConfigFile): string => (file.kind === 'launch' ? dirOf(file.path).replace(/(^|\/)Properties$/i, '') : dirOf(file.path))

/** Later wins: JSON base, JSON per environment, then .env files, then launch profiles, which set real environment variables. */
export function sourceRank(info: ConfigFileInfo): number {
  const base = info.kind === 'appsettings' ? 10 : info.kind === 'env' ? 30 : 50
  return base + (info.environment ? 10 : 0) + (info.local ? 1 : 0)
}

function entryEnvironment(file: ConfigFile, entry: ConfigEntry): string | null {
  if (file.kind !== 'launch') return file.environment
  const set = file.entries.find((item) => item.profile === entry.profile && ENVIRONMENT_VARIABLES.has(item.key))
  return set?.value ?? null
}

function toSource(file: ConfigFile, entry: ConfigEntry, environment: string | null): ConfigSource {
  return { path: file.path, line: entry.line, environment, value: entry.value, masked: entry.masked, rank: sourceRank(file), ...(entry.profile ? { profile: entry.profile } : {}) }
}

function scopeOf(dir: string, group: readonly ConfigFile[]): ConfigScope {
  const rows = new Map<string, ConfigRow>()
  const environments = new Set<string>()
  for (const file of group) {
    for (const entry of file.entries) {
      const environment = entryEnvironment(file, entry)
      if (environment) environments.add(environment)
      const id = normalKey(entry.key)
      const row = rows.get(id) ?? { key: entry.key, sources: [] }
      rows.set(id, { ...row, sources: [...row.sources, toSource(file, entry, environment)] })
    }
  }
  const sorted = [...rows.values()]
    .map((row) => ({ ...row, sources: [...row.sources].sort((a, b) => a.rank - b.rank || a.line - b.line) }))
    .sort((a, b) => a.key.localeCompare(b.key))
  return { dir, environments: [...environments].sort((a, b) => a.localeCompare(b)), rows: sorted }
}

/** Groups the files of each folder into keys, each with every place that sets it, ordered so the last one wins. */
export function buildScopes(files: readonly ConfigFile[]): ConfigScope[] {
  const byDir = new Map<string, ConfigFile[]>()
  for (const file of files) byDir.set(scopeDir(file), [...(byDir.get(scopeDir(file)) ?? []), file])
  return [...byDir].sort(([a], [b]) => a.localeCompare(b)).map(([dir, group]) => scopeOf(dir, group))
}

/** Which place sets a key in an environment (null is the base) and which places it overrides. */
export function resolveRow(row: ConfigRow, environment: string | null): RowResolution {
  const list = row.sources.filter((source) => source.environment === null || (environment !== null && sameName(source.environment, environment)))
  return { winner: list.length > 0 ? list[list.length - 1] : null, overridden: list.slice(0, -1) }
}
