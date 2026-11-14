import { describe, expect, it } from 'vitest'
import { anchorDraft, buildDraftMessage, keepDrafts, lineHash, makeDraft, markSent, MAX_DRAFTS, sanitizeDrafts, sendable, snippetAt, type NewDraft, type ReviewDraft } from '../../src/shared/reviewDrafts'

const file = ['import a', 'const one = 1', 'const two = 2', 'export { one }']

const draft = (over: Partial<NewDraft> = {}, id = 'd1'): ReviewDraft =>
  makeDraft({ folder: 'C:/p', path: 'src/a.ts', line: 2, lineText: file[1], snippet: snippetAt(file, 2), text: 'why one?', ...over }, id, 100)

describe('lineHash', () => {
  it('ignores spacing and is stable', () => {
    expect(lineHash('  const one = 1  ')).toBe(lineHash('const   one = 1'))
    expect(lineHash('const one = 1')).not.toBe(lineHash('const one = 2'))
    expect(lineHash('x')).toHaveLength(6)
  })
})

describe('anchorDraft', () => {
  it('keeps a comment on its line while the line is unchanged', () => {
    expect(anchorDraft(draft(), file)).toEqual({ line: 2, outdated: false, moved: false })
  })
  it('follows a line that moved down', () => {
    const moved = ['// new', '// header', ...file]
    expect(anchorDraft(draft(), moved)).toEqual({ line: 4, outdated: false, moved: true })
  })
  it('picks the nearest of two identical lines', () => {
    const twice = ['const one = 1', 'x', 'y', 'z', 'const one = 1']
    expect(anchorDraft(draft({ line: 4 }), twice).line).toBe(5)
  })
  it('marks a comment outdated when its line was edited away', () => {
    expect(anchorDraft(draft(), ['import a', 'const one = 100'])).toEqual({ line: null, outdated: true, moved: false })
  })
  it('trusts the line number when there is no hash', () => {
    const bare = draft({ lineText: '' })
    expect(bare.hash).toBe('')
    expect(anchorDraft(bare, file)).toEqual({ line: 2, outdated: false, moved: false })
    expect(anchorDraft({ ...bare, line: 40 }, file).outdated).toBe(true)
  })
  it('is outdated for an empty file', () => {
    expect(anchorDraft(draft(), []).outdated).toBe(true)
  })
})

describe('snippetAt', () => {
  it('shows the line with its neighbours and marks added lines', () => {
    expect(snippetAt(file, 2, new Set([2]))).toEqual(['  import a', '+ const one = 1', '  const two = 2'])
  })
  it('stays inside the file and clips long lines', () => {
    expect(snippetAt(file, 1)).toEqual(['  import a', '  const one = 1'])
    expect(snippetAt(['x'.repeat(400)], 1)[0].length).toBeLessThan(170)
    expect(snippetAt(file, 99)).toEqual([])
  })
})

describe('buildDraftMessage', () => {
  it('lists each comment with its file, lines, diff context and text in file order', () => {
    const message = buildDraftMessage([
      draft({ path: 'z.ts', snippet: ['  z context'], text: 'second file' }, 'b'),
      draft({ line: 3, endLine: 4, snippet: ['+ const two = 2'], text: 'a range' }, 'c'),
      draft({ snippet: ['  import a', '+ const one = 1'], text: 'first' }, 'a')
    ])
    expect(message).toBe(
      [
        'Review of your changes: 3 comments.',
        '',
        '1. src/a.ts:2',
        '     import a',
        '   + const one = 1',
        '   first',
        '',
        '2. src/a.ts:3-4',
        '   + const two = 2',
        '   a range',
        '',
        '3. z.ts:2',
        '     z context',
        '   second file'
      ].join('\n')
    )
  })
  it('uses paths as the agent sees them and adds the overall note', () => {
    const message = buildDraftMessage([draft({ path: 'pkg/web/a.ts', snippet: [] })], { prefix: 'pkg/web', note: ' fine\noverall ' })
    expect(message).toContain('1. a.ts:2')
    expect(message.endsWith('Overall: fine overall')).toBe(true)
  })
  it('keeps one comment on one line and names a reviewer finding with its fix', () => {
    const finding = draft({ text: 'one\ntwo', reviewer: { agent: 'codex', severity: 'high', title: 't', fix: 'do\nthis' } })
    const message = buildDraftMessage([finding])
    expect(message).toContain('   Reviewer (high): one two')
    expect(message).toContain('   Suggested fix: do this')
  })
  it('skips sent, dismissed and empty comments', () => {
    const all = markSent([draft({}, 'a'), draft({ text: '  ' }, 'b'), { ...draft({}, 'c'), status: 'dismissed' as const }, draft({}, 'd')], new Set(['a']), 5)
    expect(sendable(all).map((entry) => entry.id)).toEqual(['d'])
    expect(all[0]).toMatchObject({ status: 'sent', sentAt: 5 })
    expect(buildDraftMessage([all[0]])).toBe('')
  })
})

describe('saved drafts', () => {
  it('reads back what it wrote and drops junk', () => {
    const good = draft()
    const read = sanitizeDrafts([good, { id: 'x' }, null, 'y', { ...good, id: 'e', text: '   ' }, { ...good, id: 'f', status: 'weird', author: 'robot' }, good])
    expect(read.map((entry) => entry.id)).toEqual(['d1', 'f'])
    expect(read[1]).toMatchObject({ status: 'open', author: 'you' })
    expect(sanitizeDrafts('nope')).toEqual([])
  })
  it('keeps open comments and drops the oldest finished ones past the limit', () => {
    const many = Array.from({ length: MAX_DRAFTS + 5 }, (_, index) => ({ ...draft({}, `d${index}`), createdAt: index, status: index < 3 || index > MAX_DRAFTS ? ('open' as const) : ('sent' as const) }))
    const kept = keepDrafts(many)
    expect(kept).toHaveLength(MAX_DRAFTS)
    expect(kept.some((entry) => entry.id === 'd0')).toBe(true)
    expect(kept.some((entry) => entry.id === 'd3')).toBe(false)
  })
})
