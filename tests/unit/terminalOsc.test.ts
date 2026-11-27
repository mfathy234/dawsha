import { describe, expect, it } from 'vitest'
import { clipboardWrite, oscDirectory, oscProgress } from '../../src/shared/terminalOsc'
import { commandDuration, commandMessage, ShellCommands } from '../../src/shared/shellCommands'

describe('terminal OSC payloads', () => {
  it('accepts local file directories and decodes Windows and POSIX paths', () => {
    expect(oscDirectory('file://localhost/C:/my%20project/src')).toBe('C:/my project/src')
    expect(oscDirectory('file://myhost/home/me/src')).toBe('/home/me/src')
    expect(oscDirectory('https://example.com/path')).toBeNull()
    expect(oscDirectory('file:///tmp/%00')).toBeNull()
    expect(oscDirectory('file:///tmp/%1b')).toBeNull()
    expect(oscDirectory('file:////attacker/share')).toBeNull()
    expect(oscDirectory('file://localhost/%5cattacker%5cshare')).toBeNull()
    expect(oscDirectory('file://localhost/%2fattacker/share')).toBeNull()
  })
  it('reads bounded progress and clear states', () => {
    expect(oscProgress('4;1;64')).toEqual({ state: 1, percent: 64 })
    expect(oscProgress('4;3')).toEqual({ state: 3, percent: 0 })
    expect(oscProgress('4;0')).toEqual({ state: 0, percent: 0 })
    expect(oscProgress('4;1;101')).toBeNull()
    expect(oscProgress('4;8;2')).toBeNull()
  })
  it('decodes UTF-8 writes and always refuses reads or malformed data', () => {
    expect(clipboardWrite('c;' + Buffer.from('hello مرحبا').toString('base64'))).toBe('hello مرحبا')
    expect(clipboardWrite('c;?')).toBeNull()
    expect(clipboardWrite('c;%%%%')).toBeNull()
    expect(clipboardWrite('c;' + 'a'.repeat(1_400_000))).toBeNull()
  })
})

describe('shell command lifecycle', () => {
  it('tracks prompt, input, output and completion exactly once', () => {
    const tracker = new ShellCommands()
    tracker.mark('A', 0, 100)
    tracker.mark('B', 0, 100)
    tracker.mark('C', 1, 200, 'npm test')
    const done = tracker.mark('D;1', 9, 32_200)
    expect(done).toMatchObject({ command: 'npm test', exitCode: 1, durationMs: 32_000, inputRow: 0, outputRow: 1, endRow: 9 })
    expect(tracker.mark('D;1', 9, 33_000)).toBeNull()
    expect(commandDuration(done!.durationMs)).toBe('32s')
  })
  it('ignores orphan completion and does not treat an abandoned input as a command', () => {
    const tracker = new ShellCommands()
    expect(tracker.mark('D;0', 0, 0)).toBeNull()
    tracker.mark('B', 0, 0)
    tracker.mark('A', 1, 1)
    expect(tracker.mark('D;0', 2, 2)).toBeNull()
  })
  it('completes negative native exit codes and recovers from a prompt without D', () => {
    const tracker = new ShellCommands()
    tracker.mark('B', 0, 0)
    tracker.mark('C', 1, 1, 'native.exe')
    expect(tracker.mark('D;-1', 2, 2)?.exitCode).toBe(-1)
    tracker.mark('B', 3, 3)
    tracker.mark('C', 4, 4, 'aborted')
    tracker.mark('A', 5, 5)
    expect(tracker.mark('D;0', 6, 6)).toBeNull()
  })
  it('fences command output without allowing embedded fences to escape', () => {
    expect(commandMessage('echo hi', 'hi\n```')).toBe('Shell command and output:\n\n````text\n$ echo hi\nhi\n```\n````')
  })
})
