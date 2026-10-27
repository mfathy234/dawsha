import { open, opendir } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import type { RunCommand, RunManager } from '../../shared/runCommands'
import { runPath } from './paths'

export interface DiscoveryOptions {
  config?: string
  manager?: RunManager
  maxDepth?: number
  maxFiles?: number
  maxMs?: number
}
export interface DetectedRuns {
  commands: RunCommand[]
  warnings: string[]
  limited: boolean
}
const SKIP = new Set([
  '.git',
  'node_modules',
  'bin',
  'obj',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  'vendor',
  '.vs',
  '.idea'
])
const CONFIG = /(?:\.csproj|\.sln|\.slnx|(?:^|\/)package\.json)$/i
const slash = (v: string): string => v.replace(/\\/g, '/')
interface NodePackage {
  packageManager?: unknown
  scripts?: Record<string, unknown>
}
interface ManagerEvidence {
  declared?: RunManager
  declarationPresent: boolean
  locks: RunManager[]
  invalid: boolean
}

// JSONC without executing configuration or changing text inside quoted strings.
export function parseRunJson(text: string): unknown {
  let clean = '',
    quoted = false,
    escape = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i],
      next = text[i + 1]
    if (quoted) {
      clean += c
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') quoted = false
      continue
    }
    if (c === '"') {
      quoted = true
      clean += c
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      clean += '\n'
    } else if (c === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else clean += c
  }
  // A second quoted-string aware pass removes trailing commas.
  let result = ''
  quoted = false
  escape = false
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (quoted) {
      result += c
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') quoted = false
      continue
    }
    if (c === '"') quoted = true
    if (c === ',' && /^\s*[}\]]/.test(clean.slice(i + 1))) continue
    result += c
  }
  return JSON.parse(result)
}

export async function discoverRunCommands(
  root: string,
  options: DiscoveryOptions = {}
): Promise<DetectedRuns> {
  const commands: RunCommand[] = [],
    warnings: string[] = [],
    files: string[] = []
  let limited = false,
    seen = 0,
    bytes = 0
  const deadline = Date.now() + Math.min(options.maxMs ?? 2000, 3000)
  const maxFiles = Math.min(options.maxFiles ?? 2000, 3000),
    maxDepth = Math.min(options.maxDepth ?? 4, 8)
  const warn = (message: string): void => {
    if (warnings.length < 60) warnings.push(message)
  }
  async function read(file: string): Promise<string> {
    if (Date.now() > deadline || bytes >= 4_000_000) {
      limited = true
      throw new Error('Discovery limit reached')
    }
    const validated = await runPath(root, slash(relative(root, file)))
    const handle = await open(validated, 'r')
    try {
      const stat = await handle.stat()
      if (stat.size > 262144 || !stat.isFile())
        throw new Error('Configuration exceeds the size limit')
      // Read a fixed buffer so a growing file cannot consume unbounded memory.
      const buffer = Buffer.alloc(262145),
        result = await handle.read(buffer, 0, buffer.length, 0)
      bytes += result.bytesRead
      if (result.bytesRead > 262144)
        throw new Error('Configuration exceeds the size limit')
      return buffer.toString('utf8', 0, result.bytesRead)
    } finally {
      await handle.close()
    }
  }
  const packageCache = new Map<string, Promise<NodePackage | null>>()
  function readPackage(file: string): Promise<NodePackage | null> {
    const cached = packageCache.get(file)
    if (cached) return cached
    const reading = (async () => {
      try {
        const value: unknown = JSON.parse(await read(file))
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Invalid package configuration')
        return value as NodePackage
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    })()
    packageCache.set(file, reading)
    return reading
  }
  const managerCache = new Map<string, Promise<ManagerEvidence>>()
  function managerEvidence(folder: string): Promise<ManagerEvidence> {
    const cached = managerCache.get(folder)
    if (cached) return cached
    const reading = (async () => {
      const evidence: ManagerEvidence = {
        declarationPresent: false,
        locks: [],
        invalid: false
      }
      try {
        const pkg = await readPackage(resolve(folder, 'package.json'))
        evidence.declarationPresent = pkg?.packageManager !== undefined
        if (typeof pkg?.packageManager === 'string') {
          evidence.declared = /^(npm|pnpm|yarn|bun)@/.exec(
            pkg.packageManager
          )?.[1] as RunManager | undefined
        }
      } catch {
        evidence.invalid = true
      }
      for (const [lock, manager] of [
        ['package-lock.json', 'npm'],
        ['npm-shrinkwrap.json', 'npm'],
        ['pnpm-lock.yaml', 'pnpm'],
        ['yarn.lock', 'yarn'],
        ['bun.lock', 'bun'],
        ['bun.lockb', 'bun']
      ] as const) {
        try {
          await runPath(root, slash(relative(root, resolve(folder, lock))))
          if (!evidence.locks.includes(manager)) evidence.locks.push(manager)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            evidence.invalid = true
        }
      }
      return evidence
    })()
    managerCache.set(folder, reading)
    return reading
  }
  async function packageManager(
    folder: string,
    source: string
  ): Promise<RunManager | undefined> {
    let current = folder
    let locks: RunManager[] | undefined
    let declared: RunManager | undefined
    let unsupported = false
    while (true) {
      if (Date.now() > deadline) {
        limited = true
        return undefined
      }
      const evidence = await managerEvidence(current)
      if (evidence.invalid) {
        warn(
          `${source}: package manager metadata is unavailable or unsafe; choose a manager explicitly.`
        )
        return options.manager
      }
      if (!locks && evidence.locks.length) locks = evidence.locks
      if (evidence.declarationPresent) {
        declared = evidence.declared
        unsupported = !declared
        // A nearer declaration defines a separately managed subtree. Locks
        // below it still expose conflicts; unrelated parent locks do not apply.
        break
      }
      if (current === resolve(root)) break
      current = dirname(current)
    }
    const conflict =
      (locks?.length ?? 0) > 1 ||
      !!(declared && locks?.some((lock) => lock !== declared))
    if (conflict) {
      warn(
        `${source}: conflicting package managers; choose npm, pnpm, yarn, or bun explicitly.`
      )
      if (!options.manager) return undefined
    }
    if (unsupported) {
      warn(
        `${source}: unsupported packageManager; choose a manager explicitly.`
      )
      if (!options.manager) return undefined
    }
    return options.manager ?? declared ?? locks?.[0] ?? 'npm'
  }
  async function scan(folder: string, depth: number): Promise<void> {
    if (Date.now() > deadline || seen >= maxFiles) {
      limited = true
      return
    }
    try {
      const safeFolder = await runPath(
        root,
        slash(relative(root, folder)) || '.',
        true
      )
      const directory = await opendir(safeFolder)
      for await (const entry of directory) {
        if (++seen > maxFiles || Date.now() > deadline) {
          limited = true
          break
        }
        if (entry.isSymbolicLink()) continue
        if (
          entry.isDirectory() &&
          !SKIP.has(entry.name.toLowerCase()) &&
          !entry.name.startsWith('.')
        ) {
          if (depth >= maxDepth) limited = true
          else await scan(resolve(folder, entry.name), depth + 1)
        } else if (entry.isFile() && CONFIG.test(entry.name))
          files.push(resolve(folder, entry.name))
      }
    } catch {
      warn(
        `Could not scan ${slash(relative(root, folder)) || '.'}. Choose a configuration explicitly.`
      )
    }
  }
  if (options.config) {
    const file = await runPath(root, options.config)
    if (!CONFIG.test(slash(file)))
      throw new Error('Choose a package.json, .csproj, .sln, or .slnx file.')
    files.push(file)
  } else await scan(root, 0)
  const add = (
    source: string,
    cwd: string,
    name: string,
    executable: RunCommand['executable'],
    args: string[]
  ): void => {
    if (commands.length >= 150) {
      limited = true
      return
    }
    const id = `detected:${createHash('sha256')
      .update(JSON.stringify([source, executable, args]))
      .digest('hex')
      .slice(0, 32)}`
    commands.push({
      id,
      name,
      cwd,
      source,
      executable,
      args,
      display: [
        executable,
        ...args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
      ].join(' ')
    })
  }
  for (const file of files.sort()) {
    if (Date.now() > deadline) {
      limited = true
      break
    }
    const source = slash(relative(root, file)),
      cwd = slash(relative(root, dirname(file))) || '.'
    try {
      // Validate solutions too, even though their contents are never evaluated.
      if (/\.slnx?$/i.test(file)) {
        await read(file)
        add(source, '.', `Build ${source}`, 'dotnet', ['build', source])
        add(source, '.', `Test ${source}`, 'dotnet', ['test', source])
        continue
      }
      if (extname(file).toLowerCase() === '.csproj') {
        const xml = (await read(file)).replace(/<!--[\s\S]*?-->/g, '')
        if (
          /<IsTestProject\b[^>]*>\s*true\s*</i.test(xml) ||
          /(?:Microsoft\.NET\.Test\.Sdk|xunit|nunit|MSTest\.TestAdapter)/i.test(
            xml
          )
        )
          continue
        if (
          /\$\(|<OutputType\b[^>]*Condition\s*=|<PropertyGroup\b[^>]*Condition\s*=|<Import\b/i.test(
            xml
          )
        ) {
          warn(
            `${source}: complex or unresolved project settings; add a custom command if runnable.`
          )
          continue
        }
        if (
          !/<OutputType\b[^>]*>\s*(?:Exe|WinExe)\s*</i.test(xml) &&
          !/Sdk\s*=\s*["'][^"']*Microsoft\.NET\.Sdk\.Web/i.test(xml)
        )
          continue
        const profiles: string[] = []
        try {
          const config = resolve(
            dirname(file),
            'Properties',
            'launchSettings.json'
          )
          const json = parseRunJson(await read(config)) as {
            profiles?: Record<string, { commandName?: unknown }>
          }
          if (json.profiles && typeof json.profiles === 'object') {
            const names = new Set<string>()
            for (const [name, profile] of Object.entries(json.profiles)) {
              if (names.has(name.toLowerCase()))
                throw new Error('Duplicate profile names ignoring case')
              names.add(name.toLowerCase())
              if (
                profile?.commandName === 'Project' &&
                name.length <= 200 &&
                !/[\0\r\n]/.test(name)
              )
                profiles.push(name)
              else
                warn(
                  `${source}: profile ${name.slice(0, 200)} needs a custom command (unsupported launch type).`
                )
            }
          }
        } catch (error) {
          profiles.length = 0
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            warn(
              `${source}: launch settings unavailable or complex; using no launch profile.`
            )
        }
        const choices: Array<string | null> = profiles.length
          ? profiles
          : [null]
        for (const profile of choices) {
          const tail = profile
            ? ['--launch-profile', profile]
            : ['--no-launch-profile']
          add(
            source,
            '.',
            `Run ${source}${profile ? ` · ${profile}` : ''}`,
            'dotnet',
            ['run', '--project', source, ...tail]
          )
          add(
            source,
            '.',
            `Watch ${source}${profile ? ` · ${profile}` : ''}`,
            'dotnet',
            [
              'watch',
              '--non-interactive',
              '--project',
              source,
              'run',
              '--',
              ...tail
            ]
          )
        }
      } else {
        const pkg = await readPackage(file)
        if (!pkg) continue
        const manager = await packageManager(dirname(file), source)
        if (!manager) continue
        for (const script of ['dev', 'start', 'build', 'test'])
          if (typeof pkg.scripts?.[script] === 'string')
            add(source, cwd, `${script} · ${source}`, manager, ['run', script])
      }
    } catch {
      warn(
        `${source}: could not read configuration; edit or choose another file.`
      )
    }
  }
  if (limited)
    warn(
      'Discovery limit reached. Choose solution/project to scan a specific configuration.'
    )
  return { commands, warnings, limited }
}
