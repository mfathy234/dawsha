import { describe, expect, it } from 'vitest'
import {
  classifyPrompt,
  editRestriction,
  extractPaths,
  extractPermissionPrompt,
  isConfigPath,
  isOutsideProject,
  MAX_HISTORY,
  pushHistory,
  sanitizeDenyReason,
  stripAnsi,
  waitingLabel,
  type ApprovalHistoryEntry
} from '../../src/shared/approvals'

const box = (lines: string[]): string => lines.map((line) => `│ ${line.padEnd(60)} │`).join('\n')

const bashPrompt = box([
  'Bash command',
  '',
  '  npm test',
  '  Run the unit tests',
  '',
  'Do you want to proceed?',
  '❯ 1. Yes',
  '  2. Yes, and don\u2019t ask again for npm test commands',
  '  3. No, and tell Claude what to do differently (esc)'
])

const editPrompt = (file: string): string => box([
  'Edit file',
  file,
  '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  ' 14   runs-on: ubuntu-latest',
  ' 15 -   timeout-minutes: 10',
  ' 15 +   timeout-minutes: 20',
  '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  `Do you want to make this edit to ${file.split('/').pop()}?`,
  '❯ 1. Yes',
  '  2. Yes, allow all edits during this session (shift+tab)',
  '  3. No, and tell Claude what to do differently (esc)'
])

describe('selected option and truncation', () => {
  it('reads the highlighted option for Claude and Codex style prompts', () => {
    expect(extractPermissionPrompt(bashPrompt)?.selected).toBe('allow-once')
    expect(extractPermissionPrompt(bashPrompt.replace('❯ 1. Yes', '› 1. Yes, proceed (y)'))?.selected).toBe('allow-once')
    expect(extractPermissionPrompt(bashPrompt.replace('❯ 1. Yes', '  1. Yes').replace('  2. Yes', '❯ 2. Yes'))?.selected).toBe('other')
    expect(extractPermissionPrompt(bashPrompt.replace('❯ 1. Yes', '❯ 1. Yes, and don\u2019t ask again'))?.selected).toBe('other')
    expect(extractPermissionPrompt(bashPrompt.replace('❯ 1. Yes', '  1. Yes'))?.selected).toBe('unknown')
  })

  it('marks a prompt truncated when its header is out of view or its text was capped', () => {
    expect(extractPermissionPrompt(bashPrompt)?.truncated).toBe(false)
    const noHeader = box(['  npm run build', 'Do you want to proceed?', '❯ 1. Yes', '  2. No'])
    expect(extractPermissionPrompt(noHeader)?.truncated).toBe(true)
    const long = box(['Bash command', `  ${'x'.repeat(4000)}`, 'Do you want to proceed?', '❯ 1. Yes', '  2. No'])
    expect(extractPermissionPrompt(long)?.truncated).toBe(true)
  })

  it('restricts hook, tooling and script paths', () => {
    for (const path of ['.claude/settings.json', '.git/hooks/pre-commit', '.husky/pre-push', '.npmrc', '.vscode/tasks.json', 'Makefile', 'scripts/deploy.sh', 'build.ps1', 'run.bat', 'x.cmd']) {
      expect(isConfigPath(path), path).toBe(true)
    }
  })
})

describe('extractPermissionPrompt', () => {
  it('returns null when no permission prompt is showing', () => {
    expect(extractPermissionPrompt('')).toBeNull()
    expect(extractPermissionPrompt('building...\n1. Yes we can list things\nplain text')).toBeNull()
  })

  it('extracts a command prompt with its summary and ignores older output', () => {
    const found = extractPermissionPrompt(`${'old output\n'.repeat(40)}${bashPrompt}`)
    expect(found?.kind).toBe('command')
    expect(found?.summary).toBe('npm test')
    expect(found?.text).toContain('Bash command')
    expect(found?.text).toContain('3. No')
    expect(found?.text).not.toContain('old output')
    expect(found?.text).not.toContain('│')
  })

  it('classifies edits and names the file', () => {
    const found = extractPermissionPrompt(editPrompt('src/app.ts'))
    expect(found?.kind).toBe('edit')
    expect(found?.summary).toBe('Edit src/app.ts')
  })

  it('strips ANSI colour codes before reading', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red')
    expect(extractPermissionPrompt(bashPrompt.replace('npm test', '\u001b[1mnpm test\u001b[0m'))?.summary).toBe('npm test')
  })

  it('caps very long prompts', () => {
    const long = box(['Bash command', `  ${'x'.repeat(4000)}`, 'Do you want to proceed?', '❯ 1. Yes', '  2. No'])
    expect(extractPermissionPrompt(long)?.text.length).toBeLessThanOrEqual(1500)
    expect(extractPermissionPrompt(long)?.summary.length).toBeLessThanOrEqual(120)
  })

  it('gives the same fingerprint for the same prompt and a new one when the prompt changes', () => {
    const first = extractPermissionPrompt(bashPrompt)
    expect(extractPermissionPrompt(`\n\n${bashPrompt}\n\n`)?.fingerprint).toBe(first?.fingerprint)
    expect(extractPermissionPrompt(bashPrompt.replace('npm test', 'rm -rf dist'))?.fingerprint).not.toBe(first?.fingerprint)
    expect(first?.fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('classifyPrompt', () => {
  it('reads Claude, Codex and Gemini wording', () => {
    expect(classifyPrompt('Bash command\n npm test\nDo you want to proceed?')).toBe('command')
    expect(classifyPrompt('Would you like to run the following command?\n  npm test')).toBe('command')
    expect(classifyPrompt('Allow execution of: npm test?')).toBe('command')
    expect(classifyPrompt('Edit file\n a.ts')).toBe('edit')
    expect(classifyPrompt('Would you like to make the following edits?')).toBe('edit')
    expect(classifyPrompt('Apply this change?')).toBe('edit')
    expect(classifyPrompt('Do you want to allow this fetch?')).toBe('other')
  })

  it('lets the earlier header win when both words appear', () => {
    expect(classifyPrompt('Bash command\n git commit -m "Edit file names"')).toBe('command')
  })
})

describe('config and outside-project rule', () => {
  const folder = 'C:\\Users\\me\\proj'

  it('recognises CI and config files', () => {
    for (const path of ['.github/workflows/ci.yml', 'docker-compose.yaml', 'package.json', 'web/package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '.env', '.env.local', 'apps/api/.env.production', 'Cargo.lock']) {
      expect(isConfigPath(path), path).toBe(true)
    }
    for (const path of ['src/app.ts', 'README.md', 'environment.ts', 'src/package.jsonc.ts']) expect(isConfigPath(path), path).toBe(false)
  })

  it('treats paths outside the project folder as outside', () => {
    expect(isOutsideProject('src/a.ts', folder)).toBe(false)
    expect(isOutsideProject('C:\\Users\\me\\proj\\src\\a.ts', folder)).toBe(false)
    expect(isOutsideProject('c:/users/me/proj/src/a.ts', folder)).toBe(false)
    expect(isOutsideProject('C:\\Users\\me\\other\\a.ts', folder)).toBe(true)
    expect(isOutsideProject('C:\\Users\\me\\proj-two\\a.ts', folder)).toBe(true)
    expect(isOutsideProject('../secret.txt', folder)).toBe(true)
    expect(isOutsideProject('/etc/hosts', folder)).toBe(true)
    expect(isOutsideProject('~/.bashrc', folder)).toBe(true)
    expect(isOutsideProject('/etc/hosts', null)).toBe(true)
  })

  it('restricts edits, never commands, and reports which rule applied', () => {
    expect(editRestriction('edit', editPrompt('src/app.ts'), folder)).toBeNull()
    expect(editRestriction('edit', editPrompt('.github/workflows/ci.yml'), folder)).toBe('config')
    expect(editRestriction('edit', editPrompt('C:\\Users\\me\\other\\a.ts'), folder)).toBe('outside-project')
    expect(editRestriction('other', 'Allow writing package.json?', folder)).toBe('config')
    expect(editRestriction('command', 'Bash command\n cat package.json', folder)).toBeNull()
  })

  it('extracts path-like words without picking up plain prose', () => {
    expect(extractPaths('Do you want to make this edit to ci.yml?')).toEqual(['ci.yml'])
    expect(extractPaths('Yes we can. 1. Yes')).toEqual([])
    expect(extractPaths('see https://example.com/a.yml now')).toEqual([])
  })
})

describe('sanitizeDenyReason', () => {
  it('flattens control characters and newlines into one line', () => {
    expect(sanitizeDenyReason('Use pnpm\r\nnot npm\u0007\u001b[31m')).toBe('Use pnpm not npm [31m')
    expect(sanitizeDenyReason('a\n\n\tb')).toBe('a b')
  })

  it('drops leading slash-command, shell and memory markers', () => {
    expect(sanitizeDenyReason('/exit')).toBe('exit')
    expect(sanitizeDenyReason('  !rm -rf /')).toBe('rm -rf /')
    expect(sanitizeDenyReason('# remember')).toBe('remember')
  })

  it('caps the length and rejects non-text', () => {
    expect(sanitizeDenyReason('x'.repeat(1000))).toHaveLength(280)
    expect(sanitizeDenyReason(42)).toBe('')
    expect(sanitizeDenyReason('   ')).toBe('')
    expect(sanitizeDenyReason(undefined)).toBe('')
  })
})

describe('history and labels', () => {
  const entry = (id: number): ApprovalHistoryEntry => ({ id: String(id), time: id, allowed: true, summary: 'npm test', kind: 'command', agent: 'codex', projectName: 'p', source: 'phone', device: 'Pixel', reason: false })

  it('keeps the newest 50 answers first', () => {
    let history: ApprovalHistoryEntry[] = []
    for (let id = 1; id <= 60; id += 1) history = pushHistory(history, entry(id))
    expect(history).toHaveLength(MAX_HISTORY)
    expect(history[0].id).toBe('60')
    expect(history.at(-1)?.id).toBe('11')
  })

  it('does not mutate the previous list', () => {
    const before = [entry(1)]
    pushHistory(before, entry(2))
    expect(before).toHaveLength(1)
  })

  it('describes how long a prompt has waited', () => {
    expect(waitingLabel(0, 30_000)).toBe('just now')
    expect(waitingLabel(0, 3 * 60_000)).toBe('3m')
    expect(waitingLabel(0, 75 * 60_000)).toBe('1h 15m')
  })
})
