const REPO_URL = 'https://github.com/cloudflare/cloudflared'
const TAG_PATTERN = /^\d{4}\.\d+\.\d+$/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const latestReleaseUrl = `${REPO_URL}/releases/latest`
export const expandedAssetsUrl = (tag: string): string => `${REPO_URL}/releases/expanded_assets/${tag}`
export const releasePageUrl = (tag: string): string => `${REPO_URL}/releases/tag/${tag}`
export const assetDownloadUrl = (tag: string, asset: string): string => `${REPO_URL}/releases/download/${tag}/${asset}`

export function tagFromLocation(location: string | null): string | null {
  const match = location?.match(/\/cloudflare\/cloudflared\/releases\/tag\/([^/?#]+)\/?(?:[?#].*)?$/)
  const tag = match ? decodeURIComponent(match[1]) : ''
  return TAG_PATTERN.test(tag) ? tag : null
}

export function digestFromHtml(html: string, tag: string, asset: string): string | null {
  const name = escapeRegExp(asset)
  const notes = html.match(new RegExp(`(?:^|[^\\w.-])${name}\\s*[:=]\\s*(?:sha256:)?([a-f0-9]{64})\\b`, 'i'))
  if (notes) return notes[1].toLowerCase()
  const link = new RegExp(`releases/download/${escapeRegExp(tag)}/${name}["'?]`, 'i').exec(html)
  if (!link) return null
  const rest = html.slice(link.index + link[0].length)
  const next = rest.indexOf('releases/download/')
  const segment = rest.slice(0, next === -1 ? 2000 : Math.min(next, 2000))
  const digest = segment.match(/sha256:([a-f0-9]{64})\b/i)
  return digest ? digest[1].toLowerCase() : null
}
