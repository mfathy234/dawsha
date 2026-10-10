export const RELEASES_URL = 'https://github.com/mfathy234/dawsha/releases'
export const RELEASE_LATEST_URL = `${RELEASES_URL}/latest`
export const releaseTagUrl = (version: string): string => `${RELEASES_URL}/tag/v${version.replace(/^v/, '')}`

const REPO_PATH = '/mfathy234/dawsha'

export function safeLink(value: string): string | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port !== '' || url.username || url.password) return null
  if (url.pathname !== REPO_PATH && !url.pathname.startsWith(`${REPO_PATH}/`)) return null
  return url.href
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const decodeEntities = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')

export function htmlToMarkdown(html: string): string {
  const text = html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_all, href: string, label: string) => `[${label.replace(/<[^>]*>/g, '')}](${href})`)
    .replace(/<h[1-6][^>]*>/gi, '\n### ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|ul|ol|div)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(text).replace(/\n{3,}/g, '\n\n').trim()
}

export function normalizeNotes(notes: unknown): string {
  if (typeof notes === 'string') return /<\/?[a-z][^>]*>/i.test(notes) ? htmlToMarkdown(notes) : notes.trim()
  if (!Array.isArray(notes)) return ''
  return notes
    .map((item) => {
      const note = item && typeof item === 'object' ? (item as { note?: unknown }).note : null
      return typeof note === 'string' ? normalizeNotes(note) : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

const formatInline = (escaped: string): string =>
  escaped.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

function renderInline(raw: string): string {
  let out = ''
  let last = 0
  for (const match of raw.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    out += formatInline(escapeHtml(raw.slice(last, match.index)))
    const href = safeLink(match[2])
    const label = formatInline(escapeHtml(match[1]))
    out += href ? `<a href="${escapeHtml(href)}" data-link>${label}</a>` : label
    last = match.index + match[0].length
  }
  return out + formatInline(escapeHtml(raw.slice(last)))
}

export function renderMarkdown(source: string): string {
  const html: string[] = []
  let list: string[] | null = null
  let paragraph: string[] = []
  const flushList = (): void => {
    if (list) html.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`)
    list = null
  }
  const flushParagraph = (): void => {
    if (paragraph.length > 0) html.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  for (const line of source.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const bullet = /^\s{0,3}[-*]\s+(.*)$/.exec(line)
    if (heading) {
      flushList()
      flushParagraph()
      const level = heading[1].length <= 2 ? 3 : 4
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`)
    } else if (bullet) {
      flushParagraph()
      list = [...(list ?? []), bullet[1].trim()]
    } else if (line.trim() === '') {
      flushList()
      flushParagraph()
    } else if (list && /^\s+/.test(line)) {
      list = [...list.slice(0, -1), `${list[list.length - 1]} ${line.trim()}`]
    } else {
      flushList()
      paragraph = [...paragraph, line.trim()]
    }
  }
  flushList()
  flushParagraph()
  return html.join('')
}
