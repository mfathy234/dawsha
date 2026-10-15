import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { TabAgent } from '../shared/types'

export interface RemoteTerminalSnapshot {
  id: string
  startedAt: number
  cols: number
  rows: number
  projectId: string | null
  agent: TabAgent | null
  remoteManaged?: boolean
}

export interface RemoteTerminalScreen {
  output: string
  cols: number
  rows: number
}

export type RemoteTerminalFrame =
  | { type: 'output'; data: string }
  | { type: 'resize'; cols: number; rows: number }

interface TerminalState {
  id: string
  startedAt: number
  projectId: string | null
  agent: TabAgent | null
  remoteManaged?: boolean
  cols: number
  rows: number
  screen: Terminal
  serializer: SerializeAddon
  listeners: Set<(frame: RemoteTerminalFrame) => void>
}

const DEFAULT_SIZE = { cols: 80, rows: 24 }

// Agent CLIs are full-screen TUIs that redraw in place with cursor movement, so a raw byte log
// cannot be replayed at another size or from the middle. A headless terminal per PTY keeps the
// real screen, and browsers receive it serialized together with the PTY's exact size.
export class RemoteTerminalState {
  private readonly terminals = new Map<string, TerminalState>()

  constructor(private readonly scrollback = 1000) {}

  add(id: string, startedAt: number, metadata: { projectId: string | null; agent: TabAgent; remoteManaged?: boolean } = { projectId: null, agent: 'shell' }, size: { cols: number; rows: number } = DEFAULT_SIZE): void {
    this.remove(id)
    const cols = Math.max(2, Math.floor(size.cols))
    const rows = Math.max(1, Math.floor(size.rows))
    const screen = new Terminal({ cols, rows, scrollback: this.scrollback, allowProposedApi: true })
    const serializer = new SerializeAddon()
    screen.loadAddon(serializer)
    this.terminals.set(id, { id, startedAt, projectId: metadata.projectId, agent: metadata.agent, remoteManaged: metadata.remoteManaged, cols, rows, screen, serializer, listeners: new Set() })
  }

  append(id: string, data: string): void {
    const terminal = this.terminals.get(id)
    if (!terminal || !data) return
    terminal.screen.write(data)
    this.emit(terminal, { type: 'output', data })
  }

  resize(id: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(id)
    if (!terminal || cols < 2 || rows < 1 || (terminal.cols === cols && terminal.rows === rows)) return
    terminal.cols = cols
    terminal.rows = rows
    // Queue behind pending output so the screen resizes at the same point in the stream as the PTY did.
    terminal.screen.write('', () => terminal.screen.resize(cols, rows))
    this.emit(terminal, { type: 'resize', cols, rows })
  }

  remove(id: string): void {
    const terminal = this.terminals.get(id)
    if (!terminal) return
    terminal.listeners.clear()
    this.terminals.delete(id)
    terminal.screen.dispose()
  }

  snapshot(id?: string): RemoteTerminalSnapshot[] {
    const entries = id === undefined ? [...this.terminals.values()] : [this.terminals.get(id)].filter((entry): entry is TerminalState => Boolean(entry))
    return entries.map(({ id: terminalId, startedAt, cols, rows, projectId, agent, remoteManaged }) => ({ id: terminalId, startedAt, cols, rows, projectId, agent, ...(remoteManaged ? { remoteManaged } : {}) }))
  }

  /**
   * Resolves with the screen as of this call. Output appended after the call is not included,
   * so a subscriber registered just before calling can forward it without gaps or duplicates.
   */
  screen(id: string): Promise<RemoteTerminalScreen | null> {
    const terminal = this.terminals.get(id)
    if (!terminal) return Promise.resolve(null)
    return new Promise((resolveScreen) => {
      terminal.screen.write('', () => {
        if (this.terminals.get(id) !== terminal) { resolveScreen(null); return }
        resolveScreen({ output: terminal.serializer.serialize({ scrollback: this.scrollback }), cols: terminal.screen.cols, rows: terminal.screen.rows })
      })
    })
  }

  /** The last lines of the mirrored screen (viewport plus a little scrollback), once pending output has been applied. */
  tail(id: string, extraRows = 20): Promise<string | null> {
    const terminal = this.terminals.get(id)
    if (!terminal) return Promise.resolve(null)
    return new Promise((resolveTail) => {
      terminal.screen.write('', () => {
        if (this.terminals.get(id) !== terminal) { resolveTail(null); return }
        const buffer = terminal.screen.buffer.active
        const first = Math.max(0, buffer.length - terminal.screen.rows - extraRows)
        const lines: string[] = []
        for (let index = first; index < buffer.length; index += 1) lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
        resolveTail(lines.join('\n'))
      })
    })
  }

  subscribe(id: string, listener: (frame: RemoteTerminalFrame) => void): (() => void) | null {
    const terminal = this.terminals.get(id)
    if (!terminal) return null
    terminal.listeners.add(listener)
    return () => terminal.listeners.delete(listener)
  }

  private emit(terminal: TerminalState, frame: RemoteTerminalFrame): void {
    for (const listener of [...terminal.listeners]) {
      try { listener(frame) } catch { /* a remote client must not interrupt PTY output */ }
    }
  }
}
