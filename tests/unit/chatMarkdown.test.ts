import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../../src/shared/chatMarkdown'
import { isWebLink, parseInline } from '../../src/shared/chatMarkdownInline'
import { splitRow, tableAt } from '../../src/shared/chatMarkdownTable'

const types = (text: string): string[] => parseMarkdown(text).map((block) => block.type)

describe('parseInline', () => {
  it('reads code, bold, italic and links', () => {
    expect(parseInline('a `b` **c** *d* [e](https://x.io)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'code', text: 'b' },
      { type: 'text', text: ' ' },
      { type: 'bold', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'italic', children: [{ type: 'text', text: 'd' }] },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'e', url: 'https://x.io' }
    ])
  })

  it('leaves stray marks and math as text', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }])
    expect(parseInline('**open')).toEqual([{ type: 'text', text: '**open' }])
    expect(parseInline('[a] (b)')).toEqual([{ type: 'text', text: '[a] (b)' }])
  })

  it('does not parse inside code and honours escapes', () => {
    expect(parseInline('`**x**`')).toEqual([{ type: 'code', text: '**x**' }])
    expect(parseInline('\\*no\\*')).toEqual([{ type: 'text', text: '*no*' }])
  })

  it('never produces markup from html', () => {
    expect(parseInline('<b>x</b>')).toEqual([{ type: 'text', text: '<b>x</b>' }])
  })

  it('allows only web links to be opened', () => {
    expect(isWebLink('https://a.b/c')).toBe(true)
    expect(isWebLink('javascript:alert(1)')).toBe(false)
    expect(isWebLink('file:///c:/x')).toBe(false)
    expect(isWebLink('src/a.ts')).toBe(false)
  })
})

describe('tables', () => {
  const table = '| a | b |\n|---|:-:|\n| 1 | `x|y` |\n| 2 |'

  it('detects header plus separator', () => {
    expect(tableAt(table.split('\n'), 0)).toBe(true)
    expect(tableAt(['| a | b |', 'text'], 0)).toBe(false)
    expect(tableAt(['| a | b |', '|---|'], 0)).toBe(false)
  })

  it('splits rows on unescaped pipes outside code', () => {
    expect(splitRow('| a | `b|c` | d\\|e |')).toEqual(['a', '`b|c`', 'd|e'])
    expect(splitRow('a | b')).toEqual(['a', 'b'])
  })

  it('builds head, alignment and padded rows', () => {
    const [block] = parseMarkdown(table)
    expect(block.type).toBe('table')
    if (block.type !== 'table') return
    expect(block.align).toEqual([null, 'center'])
    expect(block.head).toHaveLength(2)
    expect(block.rows).toHaveLength(2)
    expect(block.rows[1]).toHaveLength(2)
    expect(block.rows[1][1]).toEqual([])
  })

  it('ends at a blank line and keeps following text', () => {
    expect(types('| a |\n|---|\n| 1 |\n\nafter')).toEqual(['table', 'paragraph'])
  })

  it('handles Arabic cells', () => {
    const [block] = parseMarkdown('| الاسم | القيمة |\n|---|---|\n| س | ١ |')
    expect(block.type === 'table' && block.rows[0][0]).toEqual([{ type: 'text', text: 'س' }])
  })
})

describe('parseMarkdown blocks', () => {
  it('reads paragraphs, headings and rules', () => {
    expect(types('# One\n\nText\nmore\n\n---\n\n### Three')).toEqual(['heading', 'paragraph', 'rule', 'heading'])
    const heading = parseMarkdown('## Hi ##')[0]
    expect(heading).toEqual({ type: 'heading', level: 2, inline: [{ type: 'text', text: 'Hi' }] })
  })

  it('keeps a fenced block verbatim, even unclosed', () => {
    expect(parseMarkdown('```ts\n# not heading\n- not list\n```')).toEqual([{ type: 'code', text: '# not heading\n- not list', lang: 'ts' }])
    expect(parseMarkdown('```\nopen')).toEqual([{ type: 'code', text: 'open', lang: '' }])
  })

  it('reads bullet and numbered lists', () => {
    const [list] = parseMarkdown('- a\n- b\n- c')
    expect(list.type === 'list' && list.items).toHaveLength(3)
    const [ordered] = parseMarkdown('3. a\n4. b')
    expect(ordered.type === 'list' && ordered.ordered && ordered.start).toBe(3)
  })

  it('nests by indent and keeps loose items together', () => {
    const [list] = parseMarkdown('1. a\n   - x\n   - y\n\n2. b')
    expect(list.type).toBe('list')
    if (list.type !== 'list') return
    expect(list.items).toHaveLength(2)
    expect(list.items[0].children[0].items).toHaveLength(2)
    expect(list.items[0].children[0].ordered).toBe(false)
  })

  it('joins wrapped list lines', () => {
    const [list] = parseMarkdown('- a\n  more')
    expect(list.type === 'list' && list.items[0].inline).toEqual([{ type: 'text', text: 'a\nmore' }])
  })

  it('splits when the list type changes', () => {
    expect(types('- a\n1. b')).toEqual(['list', 'list'])
  })

  it('reads quotes and nested blocks in them', () => {
    const [quote] = parseMarkdown('> one\n> - a\n> - b')
    expect(quote.type === 'quote' && quote.blocks.map((block) => block.type)).toEqual(['paragraph', 'list'])
  })

  it('stops quote recursion', () => {
    expect(() => parseMarkdown('>'.repeat(50) + ' x')).not.toThrow()
  })

  it('treats plain text and empty input safely', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(types('just words\r\nsecond line')).toEqual(['paragraph'])
    expect(types('a\n| not a table |')).toEqual(['paragraph'])
  })
})
