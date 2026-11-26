import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ShellHistory } from '../../src/main/shellHistory'

it('keeps at most 500 newest commands per project across app sessions', () => {
  const folder = mkdtempSync(join(tmpdir(), 'dawsha-history-'))
  const history = new ShellHistory(folder)
  for (let i = 0; i < 502; i++) history.add('project', `echo ${i}`, '/worktree', i)
  history.add('other', 'git status', '/other', 1)
  const restored = new ShellHistory(folder)
  expect(restored.list('project')).toHaveLength(500)
  expect(restored.list('project')[0]).toMatchObject({ command: 'echo 501', cwd: '/worktree' })
  expect(restored.list('other')).toHaveLength(1)
  history.add('project', '\x1b[2J', '/', 999)
  expect(history.list('project')).toHaveLength(500)
})
