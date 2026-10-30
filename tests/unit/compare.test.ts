import { describe, expect, it } from 'vitest'
import {
  compareNames,
  compareTitle,
  diffCommand,
  isCompareBranch,
  isCompareWorktree,
  isShortId,
  pairOf,
  promptArgs,
  quoteForShell,
  shortId,
  worktreeHasWork
} from '../../src/shared/compare'
import { migrateSettings } from '../../src/shared/settingsSchema'
import type { CompareLink } from '../../src/shared/types'

const link = (over: Partial<CompareLink> = {}): CompareLink => ({
  id: 'k1',
  slot: 'a',
  prompt: 'Why does the login test fail?',
  repo: 'C:\\work\\acme-web',
  sides: compareNames('C:\\work\\acme-web', 'x7k2p9'),
  ...over
})

describe('shortId', () => {
  it('builds six characters from the alphabet without look-alikes', () => {
    const id = shortId()
    expect(id).toMatch(/^[a-z0-9]{6}$/)
    expect(id).not.toMatch(/[ilo01]/)
    expect(isShortId(id)).toBe(true)
  })

  it('follows the random source', () => {
    expect(shortId(() => 0)).toBe('aaaaaa')
    const values = [0.99, 0, 0.5, 0.25, 0.75, 0.1]
    let index = 0
    expect(shortId(() => values[index++])).toHaveLength(6)
  })
})

describe('compareNames', () => {
  it('puts the worktrees next to the repository and names the branches', () => {
    expect(compareNames('C:\\work\\acme-web', 'x7k2p9')).toEqual({
      a: { path: 'C:\\work\\acme-web-compare-x7k2p9-a', branch: 'compare/x7k2p9-a' },
      b: { path: 'C:\\work\\acme-web-compare-x7k2p9-b', branch: 'compare/x7k2p9-b' }
    })
  })

  it('ignores trailing separators and keeps forward slashes', () => {
    expect(compareNames('C:\\work\\acme-web\\', 'abc123').a.path).toBe('C:\\work\\acme-web-compare-abc123-a')
    expect(compareNames('/home/dev/billing-api/', 'abc123').b.path).toBe('/home/dev/billing-api-compare-abc123-b')
  })

  it('handles a drive root parent and a bare folder name', () => {
    expect(compareNames('C:\\acme-web', 'abc123').a.path).toBe('C:\\acme-web-compare-abc123-a')
    expect(compareNames('acme-web', 'abc123').a.path).toBe('..\\acme-web-compare-abc123-a')
  })

  it('produces names the safety checks accept', () => {
    const sides = compareNames('C:\\work\\acme-web', 'x7k2p9')
    expect(isCompareBranch(sides.a.branch)).toBe(true)
    expect(isCompareWorktree(sides.b.path)).toBe(true)
  })
})

describe('safety checks', () => {
  it('only accept names Dawsha creates', () => {
    expect(isCompareBranch('main')).toBe(false)
    expect(isCompareBranch('compare/x7k2p9-c')).toBe(false)
    expect(isCompareBranch('compare/x7k2p9-a; rm')).toBe(false)
    expect(isCompareWorktree('C:\\work\\acme-web')).toBe(false)
    expect(isShortId('../x')).toBe(false)
    expect(isShortId('abc')).toBe(false)
  })
})

describe('promptArgs', () => {
  it('passes the prompt as the positional argument for Claude and Codex', () => {
    expect(promptArgs('claude', 'Fix the "flaky" test & rerun')).toEqual(['Fix the "flaky" test & rerun'])
    expect(promptArgs('codex', 'line one\nline two')).toEqual(['line one\nline two'])
  })

  it('uses the attached form of --prompt-interactive for Gemini so a leading dash is safe', () => {
    expect(promptArgs('gemini', 'Fix it')).toEqual(['--prompt-interactive=Fix it'])
    expect(promptArgs('gemini', '-v is not a flag')).toEqual(['--prompt-interactive=-v is not a flag'])
  })

  it('ends option parsing before a prompt that starts with a dash', () => {
    expect(promptArgs('claude', '--help me')).toEqual(['--', '--help me'])
  })

  it('sends nothing for an empty prompt', () => {
    expect(promptArgs('claude', '')).toEqual([])
  })
})

describe('pairOf', () => {
  const items = [
    { name: 'x' },
    { name: 'a', compare: link({ slot: 'a' }) },
    { name: 'b', compare: link({ slot: 'b' }) },
    { name: 'y', compare: link({ id: 'other', slot: 'a' }) },
    { name: 'z', compare: link({ id: 'third', slot: 'b' }) }
  ]

  it('pairs adjacent A and B panes with the same id', () => {
    expect(pairOf(items, 1)?.a.name).toBe('a')
    expect(pairOf(items, 1)?.b.name).toBe('b')
  })

  it('ignores plain panes, mismatched ids and wrong order', () => {
    expect(pairOf(items, 0)).toBeNull()
    expect(pairOf(items, 3)).toBeNull()
    expect(pairOf(items, 4)).toBeNull()
    expect(pairOf([items[2], items[1]], 0)).toBeNull()
  })
})

describe('diffCommand and quoting', () => {
  const clean = { exists: true, dirtyFiles: 0, commits: 0 }
  const dirty = { exists: true, dirtyFiles: 3, commits: 0 }
  const quote = (path: string): string => quoteForShell(path, 'pwsh.exe')

  it('diffs the two branches when nothing is uncommitted', () => {
    expect(diffCommand(link(), clean, { ...clean, commits: 2 }, quote)).toBe('git --no-pager diff compare/x7k2p9-a compare/x7k2p9-b')
  })

  it('diffs the two working trees when either side has uncommitted files', () => {
    expect(diffCommand(link(), clean, dirty, quote)).toBe(
      "git --no-pager diff --no-index -- 'C:\\work\\acme-web-compare-x7k2p9-a' 'C:\\work\\acme-web-compare-x7k2p9-b'"
    )
  })

  it('has nothing to diff without worktrees', () => {
    expect(diffCommand(link({ sides: null }), clean, clean, quote)).toBeNull()
  })

  it('quotes paths for cmd and for PowerShell', () => {
    expect(quoteForShell('C:\\my dir', 'C:\\Windows\\System32\\cmd.exe')).toBe('"C:\\my dir"')
    expect(quoteForShell("C:\\it's", 'pwsh.exe')).toBe("'C:\\it''s'")
    expect(quoteForShell("/Users/me/it's folder", '/bin/zsh')).toBe("'/Users/me/it'\\''s folder'")
  })

  it('knows when a worktree holds work', () => {
    expect(worktreeHasWork(clean)).toBe(false)
    expect(worktreeHasWork(dirty)).toBe(true)
    expect(worktreeHasWork({ exists: true, dirtyFiles: 0, commits: 1 })).toBe(true)
  })
})

describe('compareTitle', () => {
  it('flattens whitespace and shortens long prompts', () => {
    expect(compareTitle('  Why   does\nthis fail? ')).toBe('Why does this fail?')
    expect(compareTitle('x'.repeat(100), 10)).toBe('xxxxxxx...')
  })
})

describe('compare links in settings', () => {
  it('keeps a pane folder and a valid compare link and drops a broken one', () => {
    const saved = {
      projectId: 'a',
      folder: 'C:\\work\\acme-web-compare-x7k2p9-a',
      activeIndex: 0,
      fontSize: 15,
      tabs: [{ agent: 'claude', label: 'claude' }],
      compare: link()
    }
    const result = migrateSettings({
      projects: [{ id: 'a', name: 'acme-web', folder: 'C:\\work\\acme-web' }],
      workspace: {
        focusedIndex: 0,
        panes: [saved, { ...saved, compare: { id: 'x', slot: 'c', repo: 'r' }, folder: undefined }]
      }
    })
    expect(result.workspace.panes[0].folder).toBe(saved.folder)
    expect(result.workspace.panes[0].compare).toEqual(link())
    expect(result.workspace.panes[1].compare).toBeUndefined()
    expect(result.workspace.panes[1].folder).toBeUndefined()
  })

  it('drops incomplete sides but keeps the link', () => {
    const result = migrateSettings({
      projects: [{ id: 'a', name: 'acme-web', folder: 'C:\\work\\acme-web' }],
      workspace: {
        panes: [
          {
            projectId: 'a',
            activeIndex: 0,
            fontSize: 15,
            tabs: [{ agent: 'codex', label: 'codex' }],
            compare: { ...link(), sides: { a: { path: 'x', branch: 'y' } } }
          }
        ]
      }
    })
    expect(result.workspace.panes[0].compare?.sides).toBeNull()
  })
})
