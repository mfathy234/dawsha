import { describe, expect, it } from 'vitest'
import {
  branchNameProblem,
  formatSync,
  isDirtyRefusal,
  isDivergedPull,
  parseAheadBehind,
  parseBranchRefs,
  parseStashList,
  pickerRows,
  pullSummary,
  stashMessage,
  trimGitMessage
} from '../../src/shared/gitBranches'

const REFS = [
  'refs/heads/main\t*\t1700000300',
  'refs/heads/fix/billing-rounding\t \t1700000100',
  'refs/heads/feature/dark-mode\t \t1700000200',
  'refs/remotes/origin/HEAD\t \t1700000300',
  'refs/remotes/origin/main\t \t1700000300',
  'refs/remotes/origin/feature/dark-mode\t \t1700000200',
  'refs/remotes/origin/release/2.0\t \t1700000050',
  'refs/remotes/origin/docs/readme\t \t1700000400'
].join('\n')

describe('parseBranchRefs', () => {
  it('lists local branches newest first and marks the current one', () => {
    const list = parseBranchRefs(REFS)
    expect(list.current).toBe('main')
    expect(list.local.map((b) => b.name)).toEqual(['main', 'feature/dark-mode', 'fix/billing-rounding'])
    expect(list.local[0].current).toBe(true)
  })

  it('keeps only remote branches without a local twin and skips HEAD pointers', () => {
    const list = parseBranchRefs(REFS)
    expect(list.remote.map((b) => b.remote)).toEqual(['origin/docs/readme', 'origin/release/2.0'])
    expect(list.remote.map((b) => b.name)).toEqual(['docs/readme', 'release/2.0'])
  })

  it('has no current branch on a detached HEAD or empty output', () => {
    expect(parseBranchRefs('refs/heads/main\t \t5').current).toBeNull()
    expect(parseBranchRefs('')).toEqual({ current: null, local: [], remote: [] })
  })
})

describe('ahead and behind', () => {
  it('parses the left-right count', () => {
    expect(parseAheadBehind('2\t1\n')).toEqual({ ahead: 2, behind: 1 })
    expect(parseAheadBehind('0\t0')).toEqual({ ahead: 0, behind: 0 })
  })

  it('rejects anything else', () => {
    expect(parseAheadBehind('')).toBeNull()
    expect(parseAheadBehind('fatal: no upstream')).toBeNull()
  })

  it('formats only the non-zero sides', () => {
    expect(formatSync({ ahead: 2, behind: 1 })).toBe('↑2 ↓1')
    expect(formatSync({ ahead: 0, behind: 3 })).toBe('↓3')
    expect(formatSync({ ahead: 1, behind: 0 })).toBe('↑1')
    expect(formatSync({ ahead: 0, behind: 0 })).toBe('')
    expect(formatSync(null)).toBe('')
  })
})

describe('parseStashList', () => {
  it('reads the ref and subject of every entry', () => {
    const text = 'stash@{0}\tOn main: Dawsha: 2026-10-09 10:00\nstash@{1}\tWIP on dev: abc1234 first'
    expect(parseStashList(text)).toEqual([
      { ref: 'stash@{0}', subject: 'On main: Dawsha: 2026-10-09 10:00' },
      { ref: 'stash@{1}', subject: 'WIP on dev: abc1234 first' }
    ])
    expect(parseStashList('')).toEqual([])
  })
})

describe('branchNameProblem', () => {
  it.each(['feature/add-dark-mode', 'fix_18550', 'release/2.0', 'a'])('accepts %s', (name) => {
    expect(branchNameProblem(name)).toBeNull()
  })

  it.each(['', '  ', '-evil', '--force', 'a b', 'bad..name', 'x~1', 'x^', 'x:y', 'x?', 'x*', 'x[', 'a\\b', 'a@{b', '/lead', 'trail/', 'end.', 'x.lock', 'a//b', '@', '.hidden', 'a/.b'])(
    'rejects %j',
    (name) => {
      expect(branchNameProblem(name)).not.toBeNull()
    }
  )
})

describe('pickerRows', () => {
  const list = parseBranchRefs(REFS)

  it('shows local branches then remote-only ones', () => {
    const rows = pickerRows(list, '')
    expect(rows.map((r) => r.kind)).toEqual(['local', 'local', 'local', 'remote', 'remote'])
    expect(rows[0]).toEqual({ kind: 'local', name: 'main', current: true })
    expect(rows[3]).toEqual({ kind: 'remote', name: 'docs/readme', remote: 'origin/docs/readme' })
  })

  it('filters by substring and offers to create a new branch from the current one', () => {
    expect(pickerRows(list, 'dark').map((r) => r.kind)).toEqual(['local', 'create'])
    const rows = pickerRows(list, 'feature/billing-export')
    expect(rows[rows.length - 1]).toEqual({ kind: 'create', name: 'feature/billing-export', from: 'main' })
  })

  it('does not offer to create a branch that exists', () => {
    expect(pickerRows(list, 'main').some((r) => r.kind === 'create')).toBe(false)
    expect(pickerRows(list, 'docs/readme').some((r) => r.kind === 'create')).toBe(false)
  })

  it('flags an invalid typed name instead of offering to create it', () => {
    const rows = pickerRows(list, '-evil')
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('invalid')
  })
})

describe('git message helpers', () => {
  it('recognises git refusing a switch over local changes', () => {
    const message = 'error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\nPlease commit your changes or stash them before you switch branches.'
    expect(isDirtyRefusal(message)).toBe(true)
    expect(isDirtyRefusal('fatal: invalid reference: nope')).toBe(false)
  })

  it('recognises a diverged pull', () => {
    expect(isDivergedPull('fatal: Not possible to fast-forward, aborting.')).toBe(true)
    expect(isDivergedPull('fatal: unable to access remote')).toBe(false)
  })

  it('summarises a pull', () => {
    expect(pullSummary('Already up to date.\n')).toBe('Already up to date.')
    expect(pullSummary('Updating a1..b2\nFast-forward\n a.txt | 1 +\n 1 file changed, 1 insertion(+)\n')).toBe(
      'Pulled. 1 file changed, 1 insertion(+)'
    )
    expect(pullSummary('')).toBe('Pulled.')
  })

  it('trims blank lines and long messages', () => {
    expect(trimGitMessage('error: x  \n\n\nhint: y\n')).toBe('error: x\nhint: y')
    expect(trimGitMessage('a'.repeat(700), 10)).toBe(`${'a'.repeat(10)}…`)
  })

  it('names stashes with the date and optionally the branch', () => {
    const date = new Date('2026-10-09T10:30:00Z')
    expect(stashMessage(date)).toBe('Dawsha: 2026-10-09 10:30')
    expect(stashMessage(date, 'main')).toBe('Dawsha: main 2026-10-09 10:30')
  })
})
