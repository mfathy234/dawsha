import { describe, expect, it } from 'vitest'
import {
  branchAgo,
  branchNameProblem,
  filterBranches,
  needsBranchFilter,
  formatBytes,
  formatSize,
  stashDialogText,
  switchPlan,
  typedBranchRow,
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

describe('branch dropdown helpers', () => {
  const NOW = 1_700_100_000_000

  it('words the age of the last commit briefly', () => {
    const at = (seconds: number): number => (NOW - seconds * 1000) / 1000
    expect(branchAgo(at(20), NOW)).toBe('just now')
    expect(branchAgo(at(5 * 60), NOW)).toBe('5 min ago')
    expect(branchAgo(at(3 * 3600), NOW)).toBe('3 h ago')
    expect(branchAgo(at(2 * 86400), NOW)).toBe('2 d ago')
    expect(branchAgo(at(21 * 86400), NOW)).toBe('3 w ago')
    expect(branchAgo(at(120 * 86400), NOW)).toBe('4 mo ago')
    expect(branchAgo(at(800 * 86400), NOW)).toBe('2 y ago')
    expect(branchAgo(0, NOW)).toBe('')
  })

  it('filters local and remote-only branches by name', () => {
    const list = parseBranchRefs(REFS)
    const shown = filterBranches(list, 'DOCS')
    expect(shown.local).toEqual([])
    expect(shown.remote.map((entry) => entry.name)).toEqual(['docs/readme'])
    expect(filterBranches(list, '').local).toHaveLength(3)
  })

  it('shows the filter field only for long lists', () => {
    const list = parseBranchRefs(REFS)
    expect(needsBranchFilter(list)).toBe(false)
    const many = Array.from({ length: 9 }, (_, index) => `refs/heads/b${index}\t \t${index + 1}`).join('\n')
    expect(needsBranchFilter(parseBranchRefs(many))).toBe(true)
  })

  it('words the stash dialog from the counts', () => {
    const report = { modified: 2, untracked: 6, untrackedBytes: 716 * 1024 * 1024, capped: false }
    const off = stashDialogText('main', report, false)
    expect(off.title).toBe('Stash your changes to switch to main?')
    expect(off.body).toBe("You can't switch branches with uncommitted changes. Stash them first, and bring them back later with Apply last stash.")
    expect(off.rows).toEqual([{ label: 'Modified files', value: '2' }, { label: 'New files (716 MB)', value: '6' }])
    expect(off.checkbox?.label).toBe('Also stash the 6 new files')
    expect(off.checkbox?.hint).toBe('Off by default because large new files are slow to stash. Left out, they stay in your folder.')
    expect(off.confirmLabel).toBe('Stash 2 files and switch to main')
    expect(off.leftBehind).toBe('The 6 new files stay in your folder.')
    expect(stashDialogText('main', report, true).confirmLabel).toBe('Stash 8 files and switch to main')
    expect(stashDialogText('main', { ...report, modified: 1, untracked: 0 }, false)).toMatchObject({ confirmLabel: 'Stash 1 file and switch to main', checkbox: null, leftBehind: null })
  })

  it('only switches when just new files exist and the box is off', () => {
    const report = { modified: 0, untracked: 3, untrackedBytes: 10, capped: false }
    expect(stashDialogText('main', report, false).confirmLabel).toBe('Switch to main')
    expect(stashDialogText('main', report, true).confirmLabel).toBe('Stash 3 files and switch to main')
    expect(switchPlan(report, false)).toEqual({ stash: false, stashUntracked: false })
    expect(switchPlan(report, true)).toEqual({ stash: true, stashUntracked: true })
    expect(switchPlan({ ...report, modified: 1 }, false)).toEqual({ stash: true, stashUntracked: false })
  })

  it('says over when the size or count was cut off, and formats sizes', () => {
    expect(formatSize(5000, true)).toBe('over 4.9 KB')
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(stashDialogText('main', { modified: 0, untracked: 5000, untrackedBytes: 1024 * 1024, capped: true }, false).rows[1]).toEqual({ label: 'New files (over 1 MB)', value: '5000+' })
  })

  it('offers to create a typed name that matches no branch', () => {
    const list = parseBranchRefs(REFS)
    expect(typedBranchRow(list, 'feature/new-thing')).toMatchObject({ kind: 'create', name: 'feature/new-thing' })
    expect(typedBranchRow(list, 'bad..name')).toMatchObject({ kind: 'invalid' })
    expect(typedBranchRow(list, list.local[0].name)).toBeNull()
    expect(typedBranchRow(list, '')).toBeNull()
  })

  it('rejects names git would not accept', () => {
    for (const bad of ['', '-x', 'a b', 'a..b', 'a/', 'x.lock', '@', 'a~1']) expect(branchNameProblem(bad)).not.toBeNull()
    expect(branchNameProblem('feature/ok-1')).toBeNull()
  })
})
