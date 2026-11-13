import { describe, expect, it } from 'vitest'
import { shortSessionTitle, resolveSessionTitle, uniqueSessionTitles } from '../../src/shared/sessionTitle'

describe('shortSessionTitle', () => {
  it.each([
    ['Can you fix the login redirect?', 'Fix the login redirect'],
    ['Please add dark mode.', 'Add dark mode'],
    ['I need you to update the invoice report.', 'Update the invoice report'],
    ['Could you please help me fix flaky tests?', 'Fix flaky tests'],
    ['based on stage read this repo "C:\\Users\\tuy_2\\Downloads\\security-report.html" and fix every finding', 'Fix every security report finding'],
    ['Fix C:\\work\\app\\src\\auth.ts and add login tests', 'Fix and add login tests'],
    ['Please inspect https://example.com/a?q=secret and fix the redirect', 'Fix the redirect'],
    ['Add retry handling for `fetch(url)` failures', 'Add retry handling for failures'],
    ['```ts\nconst secret = 1\n```\nPlease fix the timeout', 'Fix the timeout'],
    ['Fix \'quoted private text\' before release', 'Fix before release'],
    ['Fix "very private text" before release', 'Fix before release'],
    ['Fix /home/me/app/auth.ts before release', 'Fix before release'],
    ['Update ./src/auth.ts and ../tests/auth.test.ts', 'Update'],
    ['Fix the failing invoice export and add regression coverage today', 'Fix the failing invoice export'],
    ['إصلاح مشكلة تسجيل الدخول وإضافة اختبارات جديدة للتطبيق', 'إصلاح مشكلة تسجيل الدخول وإضافة اختبارات'],
    ['  أصلح الخطأ،  ', 'أصلح الخطأ'],
    ['', null],
    ['Please "C:\\private\\file.txt" https://example.com `x()`', null],
    ['x'.repeat(60), null],
    ['Fix authenticationconfigurationvalidation failures', 'Fix authenticationconfigurationvalidation']
  ])('shortens %j', (prompt, expected) => expect(shortSessionTitle(prompt)).toBe(expected))

  it('caps both characters and words without cutting a word or adding punctuation', () => {
    const title = shortSessionTitle('Investigate authentication configuration validation errors after deployment')!
    expect(title.length).toBeLessThanOrEqual(48)
    expect(title.split(' ').length).toBeLessThanOrEqual(6)
    expect(title).toBe('Investigate authentication configuration')
  })
})

describe('resolveSessionTitle', () => {
  it('keeps user names as is even when long', () => {
    const name = 'My named session with many more than six words and punctuation!'
    expect(resolveSessionTitle({ name, nameSource: 'user', firstPrompt: 'Fix login', index: 1 }).title).toBe(name)
    expect(resolveSessionTitle({ name: 'AI', renamed: name, index: 1 }).title).toBe(name)
  })
  it('prefers a short agent title and otherwise uses the first prompt', () => {
    expect(resolveSessionTitle({ name: 'Invoice export', firstPrompt: 'Please fix invoice exports', index: 1 }).title).toBe('Invoice export')
    expect(resolveSessionTitle({ name: 'This is a very long automatically generated name for the whole prompt', firstPrompt: 'Please fix invoice exports', index: 1 }).title).toBe('Fix invoice exports')
  })
  it('does not treat a derived name as an agent title', () => {
    expect(resolveSessionTitle({ name: 'repo-123', nameSource: 'derived', index: 3 }).title).toBe('Claude session 3')
  })
  it('retains the complete prompt for hover and rename', () => {
    const prompt = 'Please fix the failing invoice report and add coverage for all the edge cases.'
    expect(resolveSessionTitle({ name: prompt, nameSource: 'transcript', firstPrompt: prompt, index: 1 })).toMatchObject({ title: 'Fix the failing invoice report', fullTitle: prompt, named: true })
  })
})

describe('uniqueSessionTitles', () => {
  it('numbers only inferred collisions within each project, reserving manual names', () => {
    const titles = uniqueSessionTitles([
      { projectId: 'p', title: 'Fix login', manual: false },
      { projectId: 'p', title: 'Fix login', manual: false },
      { projectId: 'p', title: 'Fix login 2', manual: true },
      { projectId: 'q', title: 'Fix login', manual: false }
    ])
    expect(titles).toEqual(['Fix login', 'Fix login 3', 'Fix login 2', 'Fix login'])
  })
  it('leaves two explicit manual names untouched', () => {
    expect(uniqueSessionTitles([{ projectId: 'p', title: 'Mine', manual: true }, { projectId: 'p', title: 'Mine', manual: true }])).toEqual(['Mine', 'Mine'])
  })
})

describe('project fallback', () => {
  it('uses the given fallback only when there is no text at all', () => {
    expect(resolveSessionTitle({ fallback: 'Smoke', index: 1 })).toMatchObject({ title: 'Smoke', named: false })
    expect(resolveSessionTitle({ firstPrompt: '"x"', fallback: 'Smoke', index: 2 }).title).toBe('Claude session 2')
  })
})
