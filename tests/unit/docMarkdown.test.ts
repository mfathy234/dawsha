import { describe, expect, it } from 'vitest'
import { escapeHtml, renderDocMarkdown, safeTarget } from '../../src/shared/docMarkdown'

describe('renderDocMarkdown escaping', () => {
  it('escapes raw html and script tags in text', () => {
    const html = renderDocMarkdown('<script>alert(1)</script> and <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })
  it('escapes inside code, headings, lists and tables', () => {
    const html = renderDocMarkdown('# <b>x</b>\n\n- <i>y</i>\n\n`<u>z</u>`\n\n```\n<div onclick=1>\n```\n\n| a | b |\n| - | - |\n| <s> | 2 |')
    expect(html).not.toMatch(/<(b|i|u|s|div)[ >]/)
    expect(html).toContain('&lt;div onclick=1&gt;')
  })
  it('only links http, https and mailto, and never puts the url in href', () => {
    const html = renderDocMarkdown('[ok](https://example.com/a) [bad](javascript:alert(1)) [file](file:///C:/x) [mail](mailto:a@b.c)')
    expect(html).toContain('data-href="https://example.com/a"')
    expect(html).toContain('data-href="mailto:a@b.c"')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('file:')
    expect(html).not.toMatch(/ href="(?!#")/)
  })
  it('does not let a quote in a link break out of the attribute', () => {
    const html = renderDocMarkdown('[x](https://e.com/a"onmouseover="alert(1))')
    expect(html).toMatch(/^<p><a href="#" data-href="[^"]*" title="[^"]*">x<\/a>\)<\/p>$/)
    expect(html).toContain('&quot;onmouseover=&quot;')
  })
  it('renders images as plain text, not elements', () => {
    expect(renderDocMarkdown('![logo](https://x/y.png)')).not.toContain('<img')
  })
  it('escapes language names in fences', () => {
    expect(renderDocMarkdown('```"><script>\nx\n```')).not.toContain('<script>')
  })
})

describe('renderDocMarkdown structure', () => {
  it('renders headings, paragraphs, emphasis and code', () => {
    const html = renderDocMarkdown('## Title\n\nSome **bold** and *it* and `code`.\nNext line')
    expect(html).toContain('<h2>Title</h2>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>it</em>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<br>')
  })
  it('renders lists, task items, quotes, rules and tables', () => {
    const html = renderDocMarkdown('- a\n- [x] b\n\n1. one\n2. two\n\n> quoted\n\n---\n\n| h1 | h2 |\n| -- | -- |\n| c1 | c2 |')
    expect(html).toContain('<ul><li>a</li><li><span class="md-task">[x]</span> b</li></ul>')
    expect(html).toContain('<ol><li>one</li><li>two</li></ol>')
    expect(html).toContain('<blockquote><p>quoted</p></blockquote>')
    expect(html).toContain('<hr>')
    expect(html).toContain('<th>h1</th>')
    expect(html).toContain('<td>c2</td>')
  })
  it('leaves underscores inside words alone', () => {
    expect(renderDocMarkdown('snake_case_name')).toContain('snake_case_name')
  })
  it('exposes the helpers', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;')
    expect(safeTarget('ftp://x')).toBeNull()
  })
})
