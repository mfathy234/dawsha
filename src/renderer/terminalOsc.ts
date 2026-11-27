import type { IDisposable, Terminal } from '@xterm/xterm'
import { clipboardWrite, oscDirectory, oscProgress, type TerminalProgress } from '../shared/terminalOsc'

export interface TerminalOscHost {
  directory(folder: string): void
  progress(value: TerminalProgress): void
  allowClipboard(): Promise<boolean>
  clipboard(text: string): Promise<void>
}

export function registerTerminalOsc(term: Terminal, host: TerminalOscHost): IDisposable {
  let clipboardPermission: Promise<boolean> | undefined
  let disposed = false
  let pending = false
  const hooks = [
    term.parser.registerOscHandler(7, (data) => {
      const folder = oscDirectory(data)
      if (folder) host.directory(folder)
      return true
    }),
    term.parser.registerOscHandler(9, (data) => {
      const progress = oscProgress(data)
      if (progress) host.progress(progress)
      return true
    }),
    term.parser.registerOscHandler(52, (data) => {
      const text = clipboardWrite(data)
      if (text === null || pending) return true
      // Keep parsing while the owner answers; a prompt must never stall terminal output.
      pending = true
      clipboardPermission ??= host.allowClipboard().catch(() => false)
      void clipboardPermission.then(async (allowed) => {
        if (allowed && !disposed) await host.clipboard(text)
      }).catch(() => undefined).finally(() => { pending = false })
      return true
    })
  ]
  return { dispose: () => { disposed = true; hooks.forEach((hook) => hook.dispose()) } }
}
