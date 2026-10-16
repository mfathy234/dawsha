import { describe, expect, it } from 'vitest'
import { trustPromptStep } from '../../src/shared/orch/trustPrompt'

const FOLDER = 'C:\\Users\\me\\Work\\Smoke Project-orch-1783d292-t-1'

const prompt = (cursorOnYes = false, folder = FOLDER): string => [
  '\x1b[2m────────────────────────\x1b[0m',
  ' Accessing workspace:',
  ` ${folder}`,
  ' Quick safety check: Is this a project you created or one you trust?',
  " Claude Code'll be able to read, edit, and execute files here.",
  ` ${cursorOnYes ? ' ' : '❯'} No, exit`,
  ` ${cursorOnYes ? '❯' : ' '} Yes, I trust this folder`,
  ' Enter to confirm · Esc to cancel'
].join('\r\n')

describe('Claude folder trust prompt', () => {
  it('moves down while the cursor is on "No", and confirms only when it is on "Yes"', () => {
    expect(trustPromptStep('claude', prompt(), FOLDER)).toBe('down')
    expect(trustPromptStep('claude', prompt(true), FOLDER)).toBe('enter')
  })

  it('matches the folder however its slashes and case are written, also when it wraps', () => {
    expect(trustPromptStep('claude', prompt(false, 'c:/users/me/work/smoke project-orch-1783d292-t-1'), FOLDER)).toBe('down')
    const wrapped = prompt(true, 'C:\\Users\\me\\Work\\Smoke\r\n Project-orch-1783d292-t-1')
    expect(trustPromptStep('claude', wrapped, 'C:\\Users\\me\\Work\\SmokeProject-orch-1783d292-t-1')).toBe('enter')
  })

  it('never answers for another folder, another CLI or other text', () => {
    expect(trustPromptStep('claude', prompt(false, 'C:\\Users\\me\\Downloads\\something'), FOLDER)).toBeNull()
    expect(trustPromptStep('codex', prompt(), FOLDER)).toBeNull()
    expect(trustPromptStep('claude', 'Do you want to proceed?\r\n❯ 1. Yes\r\n  2. No', FOLDER)).toBeNull()
    expect(trustPromptStep('claude', `I will now edit ${FOLDER}. Yes, I trust this folder is fine.`, FOLDER)).toBeNull()
  })
})
