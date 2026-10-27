import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import type {
  RunCommand,
  RunCustomCommand,
  RunDiscovery,
  RunOverrides,
  RunSnapshot,
  RunTarget
} from '../../shared/runCommands'
import { sanitizeRunOverrides } from '../../shared/runCommands'
import { knownProjectFolder } from '../knownFolder'
import { discoverRunCommands, type DiscoveryOptions } from './discovery'
import { runPath } from './paths'

export interface RunStore {
  get(): {
    projects: ReadonlyArray<{ id: string; folder: string }>
    runCommands?: unknown
  }
  update(patch: { runCommands: RunOverrides }): unknown
}
interface Runner {
  start(target: RunTarget, command: RunCommand, cwd: string): RunSnapshot
  list(): RunSnapshot[]
  stop(id: string): Promise<void>
  dispose(): void | Promise<void>
}
interface Selection {
  target: RunTarget
  commands: RunCommand[]
  at: number
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
const validText = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\0')

export class RunCommandService {
  private selections = new Map<string, Selection>()
  private closed = false
  constructor(
    private readonly store: RunStore,
    private readonly runner: Runner
  ) {}
  async target(request: unknown): Promise<RunTarget> {
    if (this.closed) throw new Error('Run manager is closed.')
    const value = object(request)
    if (!validText(value.projectId, 200) || !validText(value.folder, 4096))
      throw new Error('Select a configured project and checkout.')
    const project = this.store
      .get()
      .projects.find((p) => p.id === value.projectId)
    if (!project || !(await knownProjectFolder([project], value.folder)))
      throw new Error(
        'This checkout is not available for the selected project.'
      )
    const folder = await realpath(value.folder)
    if (folder.split(/[\\/]/).some((part) => part.toLowerCase() === '.git'))
      throw new Error('Git metadata cannot be a run checkout.')
    return { projectId: value.projectId, folder }
  }
  private overrides(target: RunTarget): RunCustomCommand[] {
    return (
      sanitizeRunOverrides(this.store.get().runCommands).find(
        (entry) =>
          entry.projectId === target.projectId && entry.folder === target.folder
      )?.commands ?? []
    )
  }
  private custom(command: RunCustomCommand): RunCommand {
    return {
      ...command,
      source: 'Local override',
      display: command.shellCommand
    }
  }
  async discover(request: unknown): Promise<RunDiscovery> {
    const target = await this.target(request),
      value = object(request),
      options: DiscoveryOptions = {}
    if (value.config !== undefined) {
      if (!validText(value.config, 2048))
        throw new Error('Choose a valid configuration.')
      options.config = value.config
    }
    if (value.manager !== undefined) {
      if (!['npm', 'pnpm', 'yarn', 'bun'].includes(String(value.manager)))
        throw new Error('Choose a supported package manager.')
      options.manager = value.manager as DiscoveryOptions['manager']
    }
    const detected = await discoverRunCommands(target.folder, options)
    const overrides = this.overrides(target),
      commands = [...detected.commands]
    for (const command of overrides) {
      const index = commands.findIndex((c) => c.id === command.id)
      if (index >= 0) commands[index] = this.custom(command)
      else commands.push(this.custom(command))
    }
    if (this.closed) throw new Error('Run manager is closed.')
    const selectionId = randomUUID()
    this.selections.set(selectionId, { target, commands, at: Date.now() })
    while (this.selections.size > 40)
      this.selections.delete(this.selections.keys().next().value!)
    return { ...detected, selectionId, commands, overrides }
  }
  async save(request: unknown, rawCommands: unknown): Promise<void> {
    const target = await this.target(request)
    if (!Array.isArray(rawCommands) || rawCommands.length > 50)
      throw new Error('Use at most 50 local commands.')
    const clean = sanitizeRunOverrides([
      { ...target, commands: rawCommands }
    ])[0]
    if (!clean || clean.commands.length !== rawCommands.length)
      throw new Error(
        'Command name, working directory, or shell command is invalid.'
      )
    for (const command of clean.commands)
      await runPath(target.folder, command.cwd, true)
    const entries = sanitizeRunOverrides(this.store.get().runCommands).filter(
      (entry) =>
        entry.projectId !== target.projectId || entry.folder !== target.folder
    )
    if (this.closed) throw new Error('Run manager is closed.')
    this.store.update({ runCommands: [...entries, clean] })
  }
  async start(request: unknown): Promise<RunSnapshot> {
    const value = object(request)
    if (!validText(value.selectionId, 100) || !validText(value.commandId, 512))
      throw new Error('Select a command and detect again.')
    const selected = this.selections.get(value.selectionId)
    if (!selected || Date.now() - selected.at > 30 * 60 * 1000)
      throw new Error('Command selection expired. Detect commands again.')
    const target = await this.target(selected.target)
    let command = selected.commands.find((c) => c.id === value.commandId)
    if (!command)
      throw new Error('Selected command is unavailable. Detect commands again.')
    const override = this.overrides(target).find((c) => c.id === command!.id)
    if (override) command = this.custom(override)
    else if (command.shellCommand)
      throw new Error('This local command was removed. Detect commands again.')
    const cwd = await runPath(target.folder, command.cwd, true)
    if (command.source !== 'Local override')
      await runPath(target.folder, command.source)
    if (this.closed) throw new Error('Run manager is closed.')
    return this.runner.start(target, command, cwd)
  }
  list(): RunSnapshot[] {
    return this.runner.list()
  }
  async stop(id: unknown): Promise<void> {
    if (!validText(id, 100)) throw new Error('Select a run to stop.')
    await this.runner.stop(id)
  }
  async dispose(): Promise<void> {
    this.closed = true
    this.selections.clear()
    await this.runner.dispose()
  }
}
