import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { app, ipcMain, type BrowserWindow } from 'electron'
import { HELP_TEXT, cliWords, parseCli, type CliCommand, type CliReply, type CliRequest } from '../shared/cli'
import { IPC } from '../shared/ipc'

const RENDERER_WAIT_MS = 30_000
const COMMAND_WAIT_MS = 60_000
const PLAN_FILE_MAX_BYTES = 64 * 1024

/** These wait for the human, so they have no time limit. */
const waitsForHuman = (command: CliCommand): boolean => command.kind === 'crew-plan' || command.kind === 'crew-ask'

export class CliRunner {
  private ready = false
  private waiting: (() => void)[] = []
  private counter = 0

  constructor(private readonly getWindow: () => BrowserWindow | null) {
    ipcMain.on(IPC.cliReady, () => {
      this.ready = true
      for (const release of this.waiting.splice(0)) release()
    })
  }

  private whenReady(): Promise<boolean> {
    if (this.ready) return Promise.resolve(true)
    return new Promise((done) => {
      const timer = setTimeout(() => done(false), RENDERER_WAIT_MS)
      this.waiting.push(() => {
        clearTimeout(timer)
        done(true)
      })
    })
  }

  private reveal(): void {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  private forward(command: CliCommand): Promise<CliReply> {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return Promise.resolve({ ok: false, exit: 1, out: 'dawsha: the window is not open.' })
    this.counter += 1
    const id = this.counter
    return new Promise((done) => {
      const finish = (reply: CliReply): void => {
        if (timer) clearTimeout(timer)
        ipcMain.removeListener(IPC.cliDone, onDone)
        done(reply)
      }
      const onDone = (_event: unknown, replyId: number, reply: CliReply): void => {
        if (replyId === id) finish(reply)
      }
      const timer = waitsForHuman(command) ? undefined : setTimeout(() => finish({ ok: false, exit: 1, out: 'dawsha: Dawsha did not answer in time.' }), COMMAND_WAIT_MS)
      ipcMain.on(IPC.cliDone, onDone)
      window.webContents.send(IPC.cliRun, id, command)
    })
  }

  async execute(request: CliRequest): Promise<CliReply> {
    const parsed = parseCli(request.args, request.cwd, (path) => resolve(request.cwd, path))
    if (!parsed.ok) return { ok: false, exit: 2, out: `dawsha: ${parsed.error}` }
    const { command } = parsed
    if (command.kind === 'help') return { ok: true, exit: 0, out: HELP_TEXT }
    if (command.kind === 'version') return { ok: true, exit: 0, out: `Dawsha ${app.getVersion()}` }
    if (!(await this.whenReady())) return { ok: false, exit: 1, out: 'dawsha: Dawsha is still starting. Try again.' }
    this.reveal()
    if (command.kind === 'open') return { ok: true, exit: 0, out: 'Opened Dawsha' }
    if (command.kind === 'crew-plan') {
      const loaded = await this.readPlan(command)
      if ('ok' in loaded) return loaded
      return this.forward(loaded)
    }
    return this.forward(command)
  }

  private async readPlan(command: Extract<CliCommand, { kind: 'crew-plan' }>): Promise<Extract<CliCommand, { kind: 'crew-plan' }> | CliReply> {
    try {
      const info = await stat(command.file)
      if (!info.isFile()) return { ok: false, exit: 1, out: `dawsha: ${command.file} is not a file.` }
      if (info.size > PLAN_FILE_MAX_BYTES) return { ok: false, exit: 1, out: `dawsha: ${command.file} is larger than ${PLAN_FILE_MAX_BYTES / 1024} KB.` }
      return { ...command, text: await readFile(command.file, 'utf8') }
    } catch {
      return { ok: false, exit: 1, out: `dawsha: could not read ${command.file}.` }
    }
  }

  async executeFromArgv(argv: string[], cwd: string): Promise<void> {
    const words = cliWords(argv.slice(1))
    if (!words) return
    const reply = await this.execute({ args: words, cwd })
    const window = this.getWindow()
    if (window && !window.isDestroyed() && reply.out) window.webContents.send(IPC.cliNotice, reply.out, reply.ok)
  }
}
