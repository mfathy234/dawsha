import { Terminal } from '@xterm/headless'
import { expect, it } from 'vitest'
import { loadTerminalUnicode } from '../../src/shared/terminalUnicode'
import { displayWidth } from '../../src/shared/terminalText'

it('reads emoji, checkmark and CJK back at the correct columns', async () => {
  const terminal = new Terminal({ cols: 20, rows: 2, allowProposedApi: true })
  try {
    loadTerminalUnicode(terminal)
    await new Promise<void>((resolve) => terminal.write('😀✔日本', resolve))
    const line = terminal.buffer.active.getLine(0)!
    expect(terminal.unicode.activeVersion).toBe('11')
    expect(line.translateToString(true)).toBe('😀✔日本')
    expect(Array.from({ length: 7 }, (_, col) => line.getCell(col)!.getWidth())).toEqual([2, 0, 1, 2, 0, 2, 0])
    expect(line.getCell(2)!.getChars()).toBe('✔')
    expect(line.getCell(3)!.getChars()).toBe('日')
    expect(line.getCell(5)!.getChars()).toBe('本')
    expect(terminal.buffer.active.cursorX).toBe(7)
    expect(displayWidth(line.translateToString(true))).toBe(7)
  } finally {
    terminal.dispose()
  }
})
