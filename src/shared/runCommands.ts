export const RUN_IPC = {
  discover: 'runs:discover',
  chooseConfig: 'runs:choose-config',
  save: 'runs:save',
  start: 'runs:start',
  stop: 'runs:stop',
  list: 'runs:list',
  changed: 'runs:changed'
} as const

export type RunManager = 'npm' | 'pnpm' | 'yarn' | 'bun'
export interface RunTarget {
  projectId: string
  folder: string
}
export interface RunCustomCommand {
  id: string
  name: string
  cwd: string
  shellCommand: string
}
export type RunOverrides = Array<RunTarget & { commands: RunCustomCommand[] }>
export interface RunCommand {
  id: string
  name: string
  cwd: string
  source: string
  display: string
  executable?: 'dotnet' | RunManager
  args?: string[]
  shellCommand?: string
}
export interface RunDiscovery {
  selectionId: string
  commands: RunCommand[]
  warnings: string[]
  limited: boolean
  overrides: RunCustomCommand[]
}
export interface RunSnapshot {
  id: string
  commandId: string
  name: string
  projectId: string
  folder: string
  cwd: string
  display: string
  status: 'running' | 'stopping' | 'stopped' | 'exited' | 'failed'
  output: string
  exitCode: number | null
  startedAt: number
}
export interface RunApi {
  discover(
    request: RunTarget & { config?: string; manager?: RunManager }
  ): Promise<RunDiscovery>
  chooseConfig(target: RunTarget): Promise<string | null>
  save(target: RunTarget, commands: RunCustomCommand[]): Promise<void>
  start(request: {
    selectionId: string
    commandId: string
  }): Promise<RunSnapshot>
  stop(runId: string): Promise<void>
  list(): Promise<RunSnapshot[]>
  onChanged(listener: (runs: RunSnapshot[]) => void): () => void
}

const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\0')
export function safeRunRelativePath(value: unknown): value is string {
  return (
    text(value, 2048) &&
    !/^(?:[a-z]:|[\\/])/i.test(value) &&
    !value
      .split(/[\\/]/)
      .some((part) => part === '..' || part.toLowerCase() === '.git')
  )
}
export function sanitizeRunOverrides(value: unknown): RunOverrides {
  if (!Array.isArray(value)) return []
  return value.slice(0, 200).flatMap((entry) => {
    if (
      !entry ||
      !text(entry.projectId, 200) ||
      !text(entry.folder, 4096) ||
      !Array.isArray(entry.commands)
    )
      return []
    const ids = new Set<string>()
    const commands: RunCustomCommand[] = entry.commands
      .slice(0, 50)
      .flatMap((c: unknown) => {
        if (!c || typeof c !== 'object') return []
        const item = c as Record<string, unknown>
        if (
          !text(item.id, 512) ||
          ids.has(item.id) ||
          !text(item.name, 200) ||
          !safeRunRelativePath(item.cwd) ||
          !text(item.shellCommand, 8192)
        )
          return []
        ids.add(item.id)
        return [
          {
            id: item.id,
            name: item.name,
            cwd: item.cwd,
            shellCommand: item.shellCommand
          }
        ]
      })
    return [{ projectId: entry.projectId, folder: entry.folder, commands }]
  })
}
