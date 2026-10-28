// A small Markdown renderer for previewing project docs. Every piece of text is escaped before it is wrapped in a tag,
// raw HTML in the source stays visible as text, and a link only keeps its target when it is http, https or mailto.

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char])

export function safeTarget(url: string): string | null {
  const trimmed = url.trim()
  return /^(https?:\/\/|mailto:)[^\s]+$/i.test(trimmed) ? trimmed : null
}

function inline(source: string): string {
  const stash: string[] = []
  const hold = (html: string): string => {
    stash.push(html)
    return `\u0000${stash.length - 1}\u0000`
  }
  let text = source.replace(/`([^`]+)`/g, (_m, code: string) => hold(`<code>${escapeHtml(code)}</code>`))
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (_m, alt: string) => hold(`<span class="md-image">${escapeHtml(alt || 'image')}</span>`))
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, url: string) => {
    const target = safeTarget(url)
    return hold(target ? `<a href="#" data-href="${escapeHtml(target)}" title="${escapeHtml(target)}">${escapeHtml(label)}</a>` : escapeHtml(label))
  })
  text = escapeHtml(text)
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>')
  text = text.replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>').replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return text.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => stash[Number(index)] ?? '')
}

const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
const isRule = (line: string): boolean => /^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line)
const isTableRule = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-')
const startsBlock = (line: string): boolean => /^(#{1,6}\s|```|>\s?|\s*[-*+]\s|\s*\d+[.)]\s)/.test(line) || isRule(line)

export function renderDocMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i += 1
      continue
    }
    const fence = /^```\s*([\w+-]*)/.exec(line)
    if (fence) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++])
      i += 1
      out.push(`<pre><code${fence[1] ? ` class="lang-${escapeHtml(fence[1])}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`)
      i += 1
      continue
    }
    if (isRule(line)) {
      out.push('<hr>')
      i += 1
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') rows.push(cells(lines[i++]))
      out.push(`<table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''))
      out.push(`<blockquote>${renderDocMarkdown(quote.join('\n'))}</blockquote>`)
      continue
    }
    const list = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (list) {
      const ordered = /\d/.test(list[2])
      const items: string[] = []
      while (i < lines.length) {
        const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
        if (!item || /\d/.test(item[2]) !== ordered) break
        const task = /^\[([ xX])\]\s+(.*)$/.exec(item[3])
        items.push(`<li>${task ? `<span class="md-task">${task[1] === ' ' ? '[ ]' : '[x]'}</span> ${inline(task[2])}` : inline(item[3])}</li>`)
        i += 1
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
      continue
    }
    const paragraph: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i])) paragraph.push(lines[i++])
    out.push(`<p>${paragraph.map((part) => inline(part.trim())).join('<br>')}</p>`)
  }
  return out.join('\n')
}
