import { describe, expect, it } from 'vitest'
import { digestFromHtml, tagFromLocation } from '../../src/main/cloudflaredRelease'

const a = 'a'.repeat(64)
const b = 'b'.repeat(64)

describe('Cloudflare release page parsing', () => {
  it('reads the tag from the latest-release redirect and rejects anything else', () => {
    expect(tagFromLocation('/cloudflare/cloudflared/releases/tag/2026.10.1')).toBe('2026.10.1')
    expect(tagFromLocation('https://github.com/cloudflare/cloudflared/releases/tag/2026.10.1')).toBe('2026.10.1')
    expect(tagFromLocation('https://example.com/cloudflare/cloudflared/releases/tag/evil')).toBeNull()
    expect(tagFromLocation('/cloudflare/cloudflared/releases/tag/../../x')).toBeNull()
    expect(tagFromLocation(null)).toBeNull()
  })

  it('reads release-note lines of the form name: hash', () => {
    const html = `<pre>cloudflared-windows-386.exe: ${b}\ncloudflared-windows-amd64.exe: ${a}</pre>`
    expect(digestFromHtml(html, '2026.10.1', 'cloudflared-windows-amd64.exe')).toBe(a)
    expect(digestFromHtml(html, '2026.10.1', 'cloudflared-windows-386.exe')).toBe(b)
  })

  it('reads the per-asset sha256 from the expanded assets list without borrowing the next asset hash', () => {
    const html = `<a href="/cloudflare/cloudflared/releases/download/2026.10.1/cloudflared-linux-arm64">x</a>
      <a href="/cloudflare/cloudflared/releases/download/2026.10.1/cloudflared-linux-amd64">x</a><span>sha256:${a}</span>`
    expect(digestFromHtml(html, '2026.10.1', 'cloudflared-linux-amd64')).toBe(a)
    expect(digestFromHtml(html, '2026.10.1', 'cloudflared-linux-arm64')).toBeNull()
  })

  it('returns null when the page lists no checksum', () => {
    expect(digestFromHtml('<html>nothing</html>', '2026.10.1', 'cloudflared-linux-amd64')).toBeNull()
  })
})
