import { describe, expect, it } from 'vitest'
import { CLOSE_BUTTON_MAX, CLOSE_TITLE_MAX, closeCopy, confirmsClose, shortTitle } from '../../src/shared/closeConfirm'

describe('closeCopy', () => {
  it('names the session in the heading and a shorter name on the button', () => {
    const copy = closeCopy('Refactor the invoice export so that query, format and write are separate steps')
    expect(copy.title).toBe('Close “Refactor the invoice export so that…”?')
    expect(copy.confirmLabel).toBe('Close “Refactor the invoice…”')
    expect(copy.confirmLabel.length).toBeLessThanOrEqual(CLOSE_BUTTON_MAX + 8)
  })

  it('keeps short names whole', () => {
    expect(closeCopy('smoke')).toEqual({ title: 'Close “smoke”?', confirmLabel: 'Close “smoke”' })
  })
})

describe('confirmsClose', () => {
  it('asks only while the session is working', () => {
    expect(confirmsClose('busy')).toBe(true)
    expect(confirmsClose('idle')).toBe(false)
    expect(confirmsClose('exited')).toBe(false)
  })
})

describe('shortTitle', () => {
  it('keeps short titles as they are', () => {
    expect(shortTitle('Fix flaky login test')).toBe('Fix flaky login test')
  })

  it('cuts long titles on a word boundary with an ellipsis', () => {
    const title = shortTitle('Refactor the invoice export so that query, format and write are separate steps')
    expect(title).toBe('Refactor the invoice export so that…')
    expect(title.length).toBeLessThanOrEqual(CLOSE_TITLE_MAX)
  })

  it('cuts a single long word hard', () => {
    const title = shortTitle('x'.repeat(100))
    expect(title).toBe(`${'x'.repeat(CLOSE_TITLE_MAX - 1)}…`)
  })

  it('folds newlines and runs of spaces', () => {
    expect(shortTitle('  Fix\n\nthe   build  ')).toBe('Fix the build')
  })

  it('drops trailing punctuation before the ellipsis', () => {
    expect(shortTitle('Update the docs, then the changelog, then the website and the screenshots', 30)).toBe('Update the docs, then the…')
  })
})
