import { describe, expect, it } from 'vitest'
import { detectTerminalMenu } from '../../src/shared/terminalMenu'
import { chatPhase } from '../../src/shared/chatLog'

const screen = (...rows: string[]): string => rows.join('\r\n')

describe('detectTerminalMenu', () => {
  it('sees Claude model picker', () => {
    expect(
      detectTerminalMenu(
        screen(' Select model', ' Switch between Claude models.', '', ' ❯ 1. Default (recommended) ✔', '   2. Sonnet', '   3. Haiku', '', ' Enter to confirm · Esc to exit')
      )
    ).toBe(true)
  })

  it('sees a Codex picker', () => {
    expect(detectTerminalMenu(screen('  Select Model and Effort', '› 1. gpt-5 (current)', '  2. gpt-5-mini', '', '  Press enter to confirm or esc to go back'))).toBe(true)
  })

  it('sees a list picker with a chosen row and no numbers', () => {
    expect(detectTerminalMenu(screen('Resume a conversation', '❯ Add dark mode toggle', '  Fix flaky test', '↑↓ to navigate · Enter to select · Esc to cancel'))).toBe(true)
  })

  it('does not call a permission prompt a menu', () => {
    expect(detectTerminalMenu(screen('Bash command', '  npm run migrate', 'Do you want to proceed?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently', 'Esc to cancel'))).toBe(false)
  })

  it('does not call the normal prompt or a busy screen a menu', () => {
    expect(detectTerminalMenu(screen('● Running the tests…', '✻ Working… (12s · esc to interrupt)', '', '> ', '  ? for shortcuts'))).toBe(false)
    expect(detectTerminalMenu(screen('› Ask Codex to do anything', '  ⏎ send   ⌃J newline   ⌃C quit'))).toBe(false)
    expect(detectTerminalMenu('')).toBe(false)
  })

  it('ignores a hint with nothing to choose', () => {
    expect(detectTerminalMenu(screen('Press Enter to continue'))).toBe(false)
  })
})

describe('chatPhase with a menu', () => {
  it('shows the menu notice over working and done, but an approval wins', () => {
    expect(chatPhase({ items: [], working: true, needsApproval: false, menuOpen: true })).toBe('menu')
    expect(chatPhase({ items: [], working: false, needsApproval: true, menuOpen: true })).toBe('approval')
  })
})
