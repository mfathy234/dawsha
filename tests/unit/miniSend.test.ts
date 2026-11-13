import { describe, expect, it } from 'vitest'
import { miniSendRefusal } from '../../src/shared/miniSend'

const prompt = ['● Bash(npm run migrate)', 'Do you want to proceed?', '1. Yes', '3. No', ''].join('\n')
const menu = ['Resume a conversation', '❯ 1. first session', '  2. second session', 'Enter to confirm · Esc to cancel'].join('\n')

describe('miniSendRefusal', () => {
  it('refuses a shell pane', () => {
    expect(miniSendRefusal({ agent: 'shell', status: 'running', tail: '$ ' })).toMatch(/agent sessions/)
  })
  it('refuses an exited session', () => {
    expect(miniSendRefusal({ agent: 'claude', status: 'exited', tail: '' })).toMatch(/exited/)
  })
  it('refuses while a permission prompt is showing', () => {
    expect(miniSendRefusal({ agent: 'claude', status: 'running', tail: prompt })).toMatch(/waiting for your answer/)
  })
  it('refuses while a menu or picker is showing', () => {
    expect(miniSendRefusal({ agent: 'claude', status: 'running', tail: menu })).toMatch(/menu/)
  })
  it('allows a quiet agent session', () => {
    expect(miniSendRefusal({ agent: 'claude', status: 'running', tail: '> ' })).toBeNull()
    expect(miniSendRefusal({ agent: 'codex', status: 'running', tail: '› ' })).toBeNull()
    expect(miniSendRefusal({ agent: 'gemini', status: 'running', tail: '> ' })).toBeNull()
  })
})
