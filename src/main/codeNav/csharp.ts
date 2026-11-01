import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { resolveExecutable } from '../executables'
import { LspClient } from './lsp'
import { stdioWire } from './transport'
import type { NavigationProcesses } from './processes'
import { containsProjectPath as inside } from '../projectContainment'

async function safeText(root: string, file: string): Promise<string> {
  try {
    const full = await realpath(file)
    if (!inside(root, full) || (await stat(full)).size > 1024 * 1024) return ''
    return await readFile(full, 'utf8')
  } catch { return '' }
}

export async function findSolution(folder: string, file: string): Promise<string | null> {
  const root = await realpath(folder)
  let directory = dirname(await realpath(file))
  let project: string | null = null
  while (inside(root, directory)) {
    const entries = await readdir(directory).catch((): string[] => [])
    if (!project) project = entries.filter(name => /\.csproj$/i.test(name)).sort().map(name => join(directory, name))[0] ?? null
    const solutions: string[] = []
    for (const name of entries.filter(name => /\.sln$/i.test(name)).sort()) {
      const actual = await realpath(join(directory, name)).catch(() => null)
      if (actual && inside(root, actual)) solutions.push(name)
    }
    if (solutions.length === 1) return join(directory, solutions[0])
    for (const name of solutions) {
      const solution = join(directory, name)
      const text = await safeText(root, solution)
      const projects = [...text.matchAll(/"([^"\r\n]+\.csproj)"/gi)].map(match => resolve(directory, match[1].replace(/\\/g, '/')))
      if (project && projects.some(candidate => candidate.toLowerCase() === project!.toLowerCase())) return solution
    }
    if (directory === root) break
    directory = dirname(directory)
  }
  return null
}

function executable(name: string): string | null {
  const command = process.platform === 'win32' ? `${name}.exe` : name
  return resolveExecutable(command, [join(homedir(), '.dotnet', 'tools')])
}

export class CsharpServers {
  private readonly servers = new Map<string, LspClient>()
  private sdk: Promise<boolean> | undefined
  private installing: Promise<{ ok: true } | { ok: false; error: string }> | undefined

  constructor(private readonly processes: Pick<NavigationProcesses, 'spawn' | 'run'>, private readonly findExecutable = executable) {}

  async server(folder: string, file: string): Promise<LspClient | null> {
    const command = this.findExecutable('csharp-ls') ?? this.findExecutable('OmniSharp') ?? this.findExecutable('omnisharp')
    if (!command) return null
    const solution = await findSolution(folder, file)
    const key = `${folder}:${solution ?? folder}`
    const previous = this.servers.get(key)
    if (previous && previous.state !== 'stopped') return previous
    const args = /omnisharp/i.test(command) ? ['--languageserver', ...(solution ? ['-s', solution] : [])] : solution ? ['--solution', solution] : []
    const { child, stop } = this.processes.spawn(command, args, solution ? dirname(solution) : folder)
    const client = new LspClient(stdioWire(child, stop), folder, solution)
    this.servers.set(key, client)
    return client
  }

  canInstall(): Promise<boolean> {
    if (this.sdk) return this.sdk
    const dotnet = this.findExecutable('dotnet')
    this.sdk = dotnet ? this.processes.run(dotnet, ['--list-sdks']).then(result => result.ok && /\d+\.\d+\.\d+\s+\[/.test(result.stdout)) : Promise.resolve(false)
    return this.sdk
  }

  install(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.installing) this.installing = this.installTool().finally(() => { this.installing = undefined })
    return this.installing
  }

  private async installTool(): Promise<{ ok: true } | { ok: false; error: string }> {
    const dotnet = this.findExecutable('dotnet')
    if (!dotnet || !(await this.canInstall())) return { ok: false, error: 'Install a dotnet SDK before installing csharp-ls.' }
    try {
      const result = await this.processes.run(dotnet, ['tool', 'install', '-g', 'csharp-ls'], 120_000)
      return result.ok ? { ok: true } : { ok: false, error: `Could not install csharp-ls: ${result.error}` }
    } catch { return { ok: false, error: 'Could not install csharp-ls.' } }
  }
}
