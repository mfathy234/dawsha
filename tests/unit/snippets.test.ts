import { describe, expect, it } from 'vitest'
import {
  expandSnippet,
  insertionData,
  shortcutConflict,
  snippetForShortcut,
  snippetPreview,
  snippetProblem,
  usesSelection,
  validateSnippet,
  visibleSnippets
} from '../../src/shared/snippets'
import { migrateSettings } from '../../src/shared/settingsSchema'
import type { Snippet } from '../../src/shared/types'

const snippet = (id: string, over: Partial<Snippet> = {}): Snippet => ({
  id,
  name: `Snippet ${id}`,
  text: 'Review the diff',
  projectId: null,
  shortcut: null,
  ...over
})

const CONTEXT = { selection: 'TypeError: x is undefined', branch: 'feature/dark-mode', project: 'acme-web', folder: 'C:\\work\\acme-web' }

describe('expandSnippet', () => {
  it('replaces every known variable, ignoring case and inner spaces', () => {
    expect(expandSnippet('Tests for {{branch}} in {{ Project }} ({{folder}})', CONTEXT)).toBe(
      'Tests for feature/dark-mode in acme-web (C:\\work\\acme-web)'
    )
    expect(expandSnippet('Explain {{selection}} and {{selection}}', CONTEXT)).toBe(
      'Explain TypeError: x is undefined and TypeError: x is undefined'
    )
  })

  it('leaves unknown variables and plain braces alone', () => {
    expect(expandSnippet('{{nope}} {branch} {{}}', CONTEXT)).toBe('{{nope}} {branch} {{}}')
  })

  it('does not expand variables found inside substituted values', () => {
    expect(expandSnippet('{{selection}}', { ...CONTEXT, selection: '{{branch}}' })).toBe('{{branch}}')
  })

  it('substitutes an empty value', () => {
    expect(expandSnippet('on [{{branch}}]', { ...CONTEXT, branch: '' })).toBe('on []')
  })

  it('detects whether the text needs a selection', () => {
    expect(usesSelection('a {{ selection }} b')).toBe(true)
    expect(usesSelection('a {{branch}} b')).toBe(false)
  })
})

describe('scopes and shortcuts', () => {
  const all = [
    snippet('g1', { shortcut: 1 }),
    snippet('p1', { projectId: 'acme', shortcut: 2 }),
    snippet('p2', { projectId: 'billing', shortcut: 2 }),
    snippet('g2')
  ]

  it('shows global snippets and the ones of the current project', () => {
    expect(visibleSnippets(all, 'acme').map((s) => s.id)).toEqual(['g1', 'p1', 'g2'])
    expect(visibleSnippets(all, null).map((s) => s.id)).toEqual(['g1', 'g2'])
  })

  it('finds the snippet of a shortcut, preferring the project one', () => {
    expect(snippetForShortcut(all, 2, 'acme')?.id).toBe('p1')
    expect(snippetForShortcut(all, 2, 'billing')?.id).toBe('p2')
    expect(snippetForShortcut(all, 2, null)).toBeUndefined()
    expect(snippetForShortcut(all, 1, 'acme')?.id).toBe('g1')
  })

  it('flags a shortcut that is taken in an overlapping scope only', () => {
    const draft = { name: 'x', text: 'y', projectId: 'docs', shortcut: 2 }
    expect(shortcutConflict(all, draft)).toBeUndefined()
    expect(shortcutConflict(all, { ...draft, projectId: null })?.id).toBe('p1')
    expect(shortcutConflict(all, { ...draft, projectId: 'acme' })?.id).toBe('p1')
    expect(shortcutConflict(all, { ...draft, id: 'p1', projectId: 'acme' })).toBeUndefined()
    expect(shortcutConflict(all, { ...draft, shortcut: null })).toBeUndefined()
  })
})

describe('validateSnippet', () => {
  const existing = [snippet('a', { name: 'Review the diff', shortcut: 1 })]
  const draft = { name: 'Commit message', text: 'Write one', projectId: null, shortcut: null }

  it('accepts a complete snippet', () => {
    expect(validateSnippet(draft, existing)).toBeNull()
  })

  it('requires a name and text and limits their size', () => {
    expect(validateSnippet({ ...draft, name: '  ' }, existing)).toBe('Enter a name.')
    expect(validateSnippet({ ...draft, text: ' \n ' }, existing)).toBe('Enter the text to insert.')
    expect(validateSnippet({ ...draft, name: 'n'.repeat(61) }, existing)).toContain('at most 60')
    expect(validateSnippet({ ...draft, text: 't'.repeat(4001) }, existing)).toContain('at most 4000')
  })

  it('rejects a shortcut outside 1-9 and one that is already used', () => {
    expect(validateSnippet({ ...draft, shortcut: 0 }, existing)).toBe('Pick a shortcut from Alt+1 to Alt+9.')
    expect(validateSnippet({ ...draft, shortcut: 1 }, existing)).toBe("Alt+1 is already used by 'Review the diff'.")
    expect(validateSnippet({ ...draft, id: 'a', name: 'Review the diff', shortcut: 1 }, existing)).toBeNull()
  })

  it('names the field each problem belongs to, so the dialog can focus it', () => {
    expect(snippetProblem({ ...draft, name: '' }, existing)?.field).toBe('name')
    expect(snippetProblem({ ...draft, text: '' }, existing)?.field).toBe('text')
    expect(snippetProblem({ ...draft, shortcut: 1 }, existing)?.field).toBe('shortcut')
    const full = Array.from({ length: 100 }, (_, index) => snippet(`s${index}`))
    expect(snippetProblem(draft, full)).toEqual({ field: 'count', message: 'You can keep at most 100 snippets.' })
    expect(snippetProblem(draft, existing)).toBeNull()
  })
})

describe('insertionData', () => {
  it('sends single-line text as typed', () => {
    expect(insertionData('Review the diff', true)).toEqual({ data: 'Review the diff', flattened: false })
    expect(insertionData('Review the diff', false)).toEqual({ data: 'Review the diff', flattened: false })
  })

  it('wraps multi-line text in a bracketed paste with carriage returns so no line runs on its own', () => {
    expect(insertionData('first\r\nsecond\nthird', true)).toEqual({
      data: '\u001b[200~first\rsecond\rthird\u001b[201~',
      flattened: false
    })
  })

  it('joins multi-line text onto one line when the terminal has no bracketed paste', () => {
    expect(insertionData('first\n\n  second  \nthird', false)).toEqual({ data: 'first second third', flattened: true })
  })

  it('removes control characters that could end the paste early or run something', () => {
    const hostile = 'ok\u001b[201~rm -rf\u0007\u0003 done'
    expect(insertionData(hostile, true).data).toBe('ok[201~rm -rf done')
    expect(insertionData('a\tb', false).data).toBe('a\tb')
  })
})

describe('snippetPreview', () => {
  it('uses the first non-empty line and shortens long text', () => {
    expect(snippetPreview('\n  Explain this error:\nmore')).toBe('Explain this error:')
    expect(snippetPreview('x'.repeat(100), 10)).toBe('xxxxxxxxx…')
  })
})

describe('snippets in settings', () => {
  it('keeps valid snippets, drops incomplete ones and ones scoped to a removed project', () => {
    const result = migrateSettings({
      projects: [{ id: 'a', name: 'acme-web', folder: 'C:\\acme-web' }],
      snippets: [
        { id: 's1', name: 'Review', text: 'Review the diff', projectId: null, shortcut: 1 },
        { id: 's2', name: 'Tests', text: 'Write tests', projectId: 'a', shortcut: 11 },
        { id: 's3', name: 'Gone', text: 'x', projectId: 'removed' },
        { id: 's4', name: '', text: 'x' },
        { id: 's5', name: 'No text' },
        { id: 's1', name: 'Same id', text: 'again' },
        7
      ]
    })
    expect(result.snippets.map((s) => s.name)).toEqual(['Review', 'Tests', 'Same id'])
    expect(result.snippets[0]).toEqual({ id: 's1', name: 'Review', text: 'Review the diff', projectId: null, shortcut: 1 })
    expect(result.snippets[1]).toMatchObject({ projectId: 'a', shortcut: null })
    expect(result.snippets[2].id).not.toBe('s1')
    expect(migrateSettings({}).snippets).toEqual([])
  })
})
