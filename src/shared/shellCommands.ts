export interface ShellCommand {
  command: string
  inputRow: number
  outputRow: number
  endRow: number
  startedAt: number
  durationMs: number
  exitCode: number | null
}

export class ShellCommands {
  private inputRow: number | null = null
  private running: Omit<ShellCommand, 'endRow' | 'durationMs' | 'exitCode'> | null = null

  mark(data: string, row: number, now: number, command = ''): ShellCommand | null {
    if (data === 'A') { this.inputRow = null; this.running = null }
    if (data === 'B') this.inputRow = row
    if (data === 'C' && !this.running && this.inputRow !== null) {
      this.running = { command: command.trim(), inputRow: this.inputRow, outputRow: row, startedAt: now }
    }
    if (!/^D(?:;-?\d+)?$/.test(data) || !this.running) return null
    const completed: ShellCommand = {
      ...this.running, endRow: row, durationMs: Math.max(0, now - this.running.startedAt),
      exitCode: data.includes(';') ? Number(data.split(';')[1]) : null
    }
    this.running = null
    this.inputRow = null
    return completed
  }
}

export function commandDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.floor(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function commandMessage(command: string, output: string): string {
  const longest = Math.max(2, ...((command + output).match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  return `Shell command and output:\n\n${fence}text\n$ ${command}\n${output}\n${fence}`
}

export interface ShellHistoryEntry { command: string; cwd: string; at: number }
export const validHistoryCommand = (command: unknown): command is string =>
  typeof command === 'string' && command.trim().length > 0 && command.length <= 8000 && !/[\x00-\x08\x0b-\x1f\x7f]/.test(command)
