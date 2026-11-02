import { describe, expect, it } from 'vitest'
import { composerHolds, submitKey } from '../../src/shared/chatSubmit'

const busy = ['• Working (3s • esc to interrupt)', '', '› reply with the single word PONG', '', '  tab to queue message   ⚠ 3 warnings'].join('\n')
const idle = ['› reply with the single word PONG', '', '  ? for shortcuts'].join('\n')
const sent = ['› reply with the single word PONG', '', '• Working (0s • esc to interrupt)', '', '› Ask Codex to do anything', '  ? for shortcuts'].join('\n')

describe('composerHolds', () => {
  it('sees the message still waiting in the input box', () => {
    expect(composerHolds(busy, 'reply with the single word PONG')).toBe(true)
    expect(composerHolds(idle, 'reply with the single word PONG')).toBe(true)
  })

  it('knows the box is empty once the message went through', () => {
    expect(composerHolds(sent, 'reply with the single word PONG')).toBe(false)
  })

  it('ignores spacing differences from how the screen was drawn', () => {
    expect(composerHolds('›replywiththesinglewordPONG', 'reply with the single word PONG')).toBe(true)
  })

  it('matches a long message by its start, since the box wraps it', () => {
    const long = 'please look through the whole repository and find every place we build a correlation id'
    expect(composerHolds(`› ${long.slice(0, 60)}\n  ${long.slice(60)}`, long)).toBe(true)
  })
})

describe('submitKey', () => {
  it('queues with Tab when Codex says Enter would not send', () => {
    expect(submitKey(busy)).toBe('\t')
  })

  it('presses nothing while Codex holds the message until it has started', () => {
    expect(submitKey(['› reply with the single word PONG', '  Waiting for startup  · esc cancel'].join('\n'))).toBeNull()
  })

  it('presses Enter otherwise', () => {
    expect(submitKey(idle)).toBe('\r')
  })
})
