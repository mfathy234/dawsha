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
    // Claude wraps a long path at a space, as captured from a real 80-column pane: the space is lost in the wrap.
    const wrapped = prompt(true, 'C:\\Users\\me\\Work\\Smoke\r\n Project-orch-1783d292-t-1')
    expect(trustPromptStep('claude', wrapped, FOLDER)).toBe('enter')
    const real = [
      ' Accessing workspace:', ' C:\\Users\\tuy_2\\AppData\\Local\\Temp\\dawsha-e2e-eWlFcQ\\Smoke', ' Project-orch-a2ffa986',
      ' Quick safety check: Is this a project you created or one you trust? (Like your', ' Security guide',
      ' ❯ No, exit', '   Yes, I trust this folder', ' Enter to confirm · Esc to cancel'
    ].join('\r\n')
    expect(trustPromptStep('claude', real, 'C:\\Users\\tuy_2\\AppData\\Local\\Temp\\dawsha-e2e-eWlFcQ\\Smoke Project-orch-a2ffa986')).toBe('down')
  })

  it('never answers for another folder, another CLI or other text', () => {
    expect(trustPromptStep('claude', prompt(false, 'C:\\Users\\me\\Downloads\\something'), FOLDER)).toBeNull()
    expect(trustPromptStep('codex', prompt(), FOLDER)).toBeNull()
    expect(trustPromptStep('claude', 'Do you want to proceed?\r\n❯ 1. Yes\r\n  2. No', FOLDER)).toBeNull()
    expect(trustPromptStep('claude', `I will now edit ${FOLDER}. Yes, I trust this folder is fine.`, FOLDER)).toBeNull()
  })
})

describe('Codex folder trust prompt', () => {
  // Rendered from a real Codex v0.162 capture in an 80-column pane (the path wraps at its space).
  const FOLDER_CODEX = 'C:\\Users\\tuy_2\\AppData\\Local\\Temp\\dawsha-e2e-JQTwGA\\Smoke Project-orch-6f660052-t-1'
  const codexPrompt = (cursorOnTrust = true, folderLines = [' C:\\Users\\tuy_2\\AppData\\Local\\Temp\\dawsha-e2e-JQTwGA\\Smoke                   ', '  Project-orch-6f660052-t-1']): string => [
    '  Folder access', ...folderLines, '',
    '  Note: You’re in a subdirectory of a Git project. Trusting will apply to the', '  repository root:',
    '  c:\\users\\tuy_2\\appdata\\local\\temp\\dawsha-e2e-jqtwga\\smoke project', '',
    '  Trust this folder? Codex can read, edit, and run files here, subject to your', '  permission settings.', '',
    `${cursorOnTrust ? '›' : ' '} 1. Trust and continue`, `${cursorOnTrust ? ' ' : '›'} 2. Quit`, '', '  enter continue · esc quit'
  ].join('\r\n')

  it('confirms "Trust and continue" for the agent\'s own worktree', () => {
    expect(trustPromptStep('codex', codexPrompt(), FOLDER_CODEX)).toBe('enter')
  })

  it('never confirms while the cursor is on Quit, or for another folder', () => {
    expect(trustPromptStep('codex', codexPrompt(false), FOLDER_CODEX)).toBeNull()
    expect(trustPromptStep('codex', codexPrompt(true, ['  C:\\Users\\me\\Downloads\\other']), FOLDER_CODEX)).toBeNull()
  })
})
