import { describe, expect, it } from 'vitest'
import { PendingTerminalOutput } from '../../src/renderer/pendingTerminalOutput'

describe('PendingTerminalOutput', () => {
  it('keeps only the newest characters per terminal', () => {
    const pending = new PendingTerminalOutput(2, 5)
    pending.append('one', 'abc')
    pending.append('one', 'def')
    expect(pending.take('one')).toEqual(['bc', 'def'])
  })

  it('bounds the number of terminals and releases output after consumption or exit', () => {
    const pending = new PendingTerminalOutput(1, 10)
    pending.append('old', 'old output')
    pending.append('new', 'new output')
    expect(pending.take('old')).toEqual([])
    expect(pending.take('new')).toEqual(['new output'])

    pending.append('exited', 'pending')
    pending.delete('exited')
    expect(pending.take('exited')).toEqual([])
  })
})
