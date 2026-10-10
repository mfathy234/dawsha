import { describe, expect, it } from 'vitest'
import { htmlToMarkdown, normalizeNotes, releaseTagUrl, renderMarkdown, safeLink } from '../../src/shared/markdown'

describe('safeLink', () => {
  it('allows the project repository on github.com over https', () => {
    expect(safeLink('https://github.com/mfathy234/dawsha/releases/tag/v0.4.0')).toBe('https://github.com/mfathy234/dawsha/releases/tag/v0.4.0')
    expect(safeLink('https://github.com/mfathy234/dawsha')).toBe('https://github.com/mfathy234/dawsha')
  })

  it('rejects other hosts, repositories, schemes and tricks', () => {
    for (const bad of [
      'http://github.com/mfathy234/dawsha/releases',
      'https://github.com/mfathy234/dawsha-evil/releases',
      'https://github.com/someone/dawsha',
      'https://github.com/mfathy234/dawsha/../../evil/repo',
      'https://github.com/mfathy234/dawsha/%2e%2e/%2e%2e/evil/repo',
      'https://github.com.evil.example/mfathy234/dawsha/x',
      'https://user@github.com/mfathy234/dawsha/x',
      'https://github.com:444/mfathy234/dawsha/x',
      'javascript:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'not a url',
      ''
    ]) {
      expect(safeLink(bad)).toBeNull()
    }
  })

  it('builds the release tag url', () => {
    expect(releaseTagUrl('0.4.0')).toBe('https://github.com/mfathy234/dawsha/releases/tag/v0.4.0')
    expect(releaseTagUrl('v0.4.0')).toBe('https://github.com/mfathy234/dawsha/releases/tag/v0.4.0')
  })
})

describe('renderMarkdown', () => {
  it('renders headings, bullets, code and bold', () => {
    const html = renderMarkdown('### Added\n\n- One with `code`\n- Two **bold**\n\nA paragraph.')
    expect(html).toBe('<h4>Added</h4><ul><li>One with <code>code</code></li><li>Two <strong>bold</strong></li></ul><p>A paragraph.</p>')
  })

  it('joins wrapped bullet lines', () => {
    expect(renderMarkdown('- first\n  second')).toBe('<ul><li>first second</li></ul>')
  })

  it('escapes html everywhere', () => {
    const html = renderMarkdown('### <img src=x onerror=alert(1)>\n\n- <script>alert(1)</script> & "quotes"\n\n<b>raw</b>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;')
  })

  it('keeps links to this repository and turns every other link into plain text', () => {
    const html = renderMarkdown(
      '- [notes](https://github.com/mfathy234/dawsha/releases/tag/v0.4.0) and [evil](https://evil.example/x) and [js](javascript:alert(1))'
    )
    expect(html).toContain('<a href="https://github.com/mfathy234/dawsha/releases/tag/v0.4.0" data-link>notes</a>')
    expect(html).toContain('and evil and js')
    expect(html).not.toContain('evil.example')
    expect(html).not.toContain('javascript:')
  })

  it('does not let a link label or url break out of the attribute', () => {
    const html = renderMarkdown('[x" onclick="alert(1)](https://github.com/mfathy234/dawsha/a"b)')
    expect(html).not.toMatch(/<a [^>]*onclick/)
  })
})

describe('release notes from GitHub', () => {
  it('turns the html GitHub sends into markdown', () => {
    const md = htmlToMarkdown(
      '<h2>What&#39;s changed</h2><ul><li>Fix &amp; polish</li><li><a href="https://github.com/mfathy234/dawsha/pull/2">PR 2</a></li></ul>'
    )
    expect(md).toContain("### What's changed")
    expect(md).toContain('- Fix & polish')
    expect(md).toContain('- [PR 2](https://github.com/mfathy234/dawsha/pull/2)')
  })

  it('normalizes strings, markdown, arrays and junk', () => {
    expect(normalizeNotes('### Added\n- x')).toBe('### Added\n- x')
    expect(normalizeNotes('<p>Hello</p>')).toBe('Hello')
    expect(normalizeNotes([{ version: '0.4.0', note: '- a' }, { version: '0.3.0', note: null }])).toBe('- a')
    expect(normalizeNotes(undefined)).toBe('')
    expect(normalizeNotes(42)).toBe('')
  })

  it('stays safe when html notes carry a script', () => {
    const html = renderMarkdown(normalizeNotes('<p>ok</p><script>alert(1)</script>'))
    expect(html).not.toContain('<script')
  })
})
