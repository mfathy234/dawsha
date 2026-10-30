import { describe, expect, it } from 'vitest'
import { parsePermissionDetail } from '../../src/shared/permissionPrompt'

const CLAUDE_BASH = [
  '╭──────────────────────────────────────────────────────╮',
  '│ Bash command                                         │',
  '│                                                      │',
  '│   npm run migrate -- --env dev                       │',
  '│   Apply the pending migration to the dev database    │',
  '│                                                      │',
  '│ Do you want to proceed?                              │',
  '│ ❯ 1. Yes                                             │',
  "│   2. Yes, and don't ask again for npm run commands   │",
  '│      in /home/me/app                                 │',
  '│   3. No, and tell Claude what to do differently (esc)│',
  '╰──────────────────────────────────────────────────────╯'
].join('\n')

const CLAUDE_EDIT = [
  ' Edit file',
  ' src/sender.ts',
  ' ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  '  12   const wait = backoff(attempt)',
  ' Do you want to make this edit to sender.ts?',
  ' ❯ 1. Yes',
  '   2. Yes, and don\'t ask again this session (shift+tab)',
  '   3. No, and tell Claude what to do differently (esc)'
].join('\n')

const CLAUDE_WRITE_ONCE = [
  ' Create file',
  ' docs/notes.md',
  'Do you want to create notes.md?',
  ' ❯ 1. Yes',
  '   2. No, and tell Claude what to do differently (esc)'
].join('\n')

const CODEX_COMMAND = [
  'Would you like to run the following command?',
  '',
  '  Reason: Apply the pending migration to dev',
  '',
  '  $ npm run migrate -- --env dev',
  '',
  '› 1. Yes, proceed (y)',
  "  2. Yes, and don't ask again for commands that start with `npm run migrate` (p)",
  '  3. No, and tell Codex what to do differently (esc)'
].join('\n')

const CODEX_EDIT = [
  'Would you like to make the following edits?',
  '',
  'Reason: Keep the retry count in sync',
  '',
  '  src/sender.ts (+3 -1)',
  '',
  '› 1. Yes, proceed (y)',
  '  2. Yes, and don\'t ask again for these files (a)',
  '  3. No, and tell Codex what to do differently (esc)'
].join('\n')

describe('parsePermissionDetail', () => {
  it('reads the command, the tool and the three choices from a Claude Code Bash prompt', () => {
    const detail = parsePermissionDetail(CLAUDE_BASH)
    expect(detail.tool).toBe('Bash')
    expect(detail.target).toBe('npm run migrate -- --env dev')
    expect(detail.options.map((option) => option.kind)).toEqual(['once', 'always', 'deny'])
    expect(detail.options[1].number).toBe(2)
  })

  it('reads the file from a Claude Code edit prompt and offers an allow-always choice for the session', () => {
    const detail = parsePermissionDetail(CLAUDE_EDIT)
    expect(detail.tool).toBe('Edit')
    expect(detail.target).toBe('src/sender.ts')
    expect(detail.options.map((option) => option.kind)).toEqual(['once', 'always', 'deny'])
  })

  it('treats a file creation as a Write and leaves out the always choice when the prompt does not offer it', () => {
    const detail = parsePermissionDetail(CLAUDE_WRITE_ONCE)
    expect(detail.tool).toBe('Write')
    expect(detail.target).toBe('docs/notes.md')
    expect(detail.options.map((option) => option.kind)).toEqual(['once', 'deny'])
    expect(detail.options.some((option) => option.kind === 'always')).toBe(false)
  })

  it('reads the command from a Codex run prompt, with its prefix removed and the hotkey dropped from labels', () => {
    const detail = parsePermissionDetail(CODEX_COMMAND)
    expect(detail.tool).toBe('Bash')
    expect(detail.target).toBe('npm run migrate -- --env dev')
    expect(detail.options.map((option) => option.kind)).toEqual(['once', 'always', 'deny'])
    expect(detail.options[1].label).toBe('Yes, and don\'t ask again for commands that start with `npm run migrate`')
  })

  it('reads the changed file from a Codex edit prompt', () => {
    const detail = parsePermissionDetail(CODEX_EDIT)
    expect(detail.tool).toBe('Edit')
    expect(detail.target).toBe('src/sender.ts')
    expect(detail.options.map((option) => option.kind)).toEqual(['once', 'always', 'deny'])
  })

  it('falls back to an inline tool call and to a generic label when no header is shown', () => {
    expect(parsePermissionDetail('Do you want to proceed?\n 1. Yes\n 2. No')).toMatchObject({ tool: 'Requested action', target: '' })
    expect(parsePermissionDetail('Bash(git push --force origin main)\nDo you want to proceed?\n❯ 1. Yes')).toMatchObject({
      tool: 'Bash',
      target: 'git push --force origin main'
    })
  })

  it('returns no options when the prompt has no numbered choices', () => {
    expect(parsePermissionDetail('Working on it…').options).toEqual([])
    expect(parsePermissionDetail('').tool).toBe('Requested action')
  })
})
