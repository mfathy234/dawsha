import { Unicode11Addon } from '@xterm/addon-unicode11'
import type { Terminal, IUnicodeVersionProvider } from '@xterm/xterm'
import type { Terminal as HeadlessTerminal } from '@xterm/headless'

export function loadTerminalUnicode(terminal: Terminal | HeadlessTerminal): void {
  terminal.loadAddon(new Unicode11Addon())
  terminal.unicode.activeVersion = '11'
}

function widthProvider(): IUnicodeVersionProvider {
  let provider: IUnicodeVersionProvider | undefined
  // The addon exposes its width table through the public unicode.register API.
  new Unicode11Addon().activate({ unicode: { register: (value: IUnicodeVersionProvider) => { provider = value } } } as Terminal)
  if (!provider) throw new Error('Unicode 11 width provider unavailable')
  return provider
}

export const terminalWidthProvider = widthProvider()
