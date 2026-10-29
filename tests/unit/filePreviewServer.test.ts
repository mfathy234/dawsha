import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PREVIEW_CSP, PreviewServer } from '../../src/main/filePreviewServer'

let root = ''
let outside = ''
const gate = async (folder: string): Promise<string | null> => (folder === root ? folder : null)

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dawsha-preview-')))
  outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'dawsha-preview-out-')))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

const put = (rel: string, text: string): void => {
  const full = join(root, ...rel.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}

async function open(server: PreviewServer, path: string, text: string | null = null): Promise<string> {
  const result = await server.register(root, path, text)
  if (!result.ok) throw new Error(result.error)
  return result.url
}

const text = (body: Buffer | string): string => body.toString()

describe('registering a preview', () => {
  it('only accepts html files of a known project folder', async () => {
    put('docs/page.html', '<h1>hi</h1>')
    put('docs/notes.txt', 'x')
    const server = new PreviewServer(gate)
    expect(await server.register(root, 'docs/notes.txt', null)).toMatchObject({ ok: false })
    expect(await server.register(outside, 'docs/page.html', null)).toMatchObject({ ok: false })
    expect(await server.register(root, '../page.html', null)).toMatchObject({ ok: false })
    const url = await open(server, 'docs/page.html')
    expect(url).toMatch(/^dawsha-preview:\/\/[0-9a-f]{24}\/page\.html\?v=\d+$/)
  })
  it('does not accept an html path that leaves the project through a link', async () => {
    writeFileSync(join(outside, 'secret.html'), 'secret')
    symlinkSync(outside, join(root, 'escape'), 'junction')
    const server = new PreviewServer(gate)
    expect(await server.register(root, 'escape/secret.html', null)).toMatchObject({ ok: false })
  })
  it('keeps one token per folder tree so a re-render reuses it', async () => {
    put('docs/a.html', 'a')
    put('docs/b.html', 'b')
    const server = new PreviewServer(gate)
    const a = new URL(await open(server, 'docs/a.html')).host
    const b = new URL(await open(server, 'docs/b.html')).host
    expect(a).toBe(b)
  })
})

describe('serving a preview', () => {
  it('serves the page with its own policy: no network, scripts allowed, same scheme for assets', async () => {
    put('docs/page.html', '<script>1</script>')
    const server = new PreviewServer(gate)
    const response = await server.serve(await open(server, 'docs/page.html'))
    expect(response.status).toBe(200)
    expect(text(response.body)).toBe('<script>1</script>')
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8')
    expect(response.headers['Content-Security-Policy']).toBe(PREVIEW_CSP)
    expect(PREVIEW_CSP).toContain("connect-src 'none'")
    expect(PREVIEW_CSP).toContain("script-src 'unsafe-inline' dawsha-preview:")
    expect(PREVIEW_CSP).toMatch(/img-src dawsha-preview: data:/)
    expect(PREVIEW_CSP).not.toMatch(/https?:|'self'|\*/)
    expect(response.headers['X-Content-Type-Options']).toBe('nosniff')
  })
  it('serves what the editor holds instead of the saved file', async () => {
    put('page.html', 'saved')
    const server = new PreviewServer(gate)
    const response = await server.serve(await open(server, 'page.html', 'unsaved edit'))
    expect(text(response.body)).toBe('unsaved edit')
  })
  it('serves assets next to the page and below it, with their types', async () => {
    put('docs/page.html', 'x')
    put('docs/style.css', 'body{}')
    put('docs/img/logo.svg', '<svg/>')
    put('docs/app.js', 'run()')
    const server = new PreviewServer(gate)
    const host = new URL(await open(server, 'docs/page.html')).host
    const css = await server.serve(`dawsha-preview://${host}/style.css`)
    expect([css.status, css.headers['Content-Type']]).toEqual([200, 'text/css; charset=utf-8'])
    const svg = await server.serve(`dawsha-preview://${host}/img/logo.svg`)
    expect([svg.status, svg.headers['Content-Type']]).toEqual([200, 'image/svg+xml'])
    expect((await server.serve(`dawsha-preview://${host}/app.js`)).headers['Content-Type']).toBe('text/javascript; charset=utf-8')
    expect((await server.serve(`dawsha-preview://${host}/style.css`)).headers['Access-Control-Allow-Origin']).toBe('*')
  })
  it('refuses traversal in every spelling', async () => {
    put('docs/page.html', 'x')
    put('secret.txt', 'top secret')
    put('other/x.css', 'x')
    const server = new PreviewServer(gate)
    const host = new URL(await open(server, 'docs/page.html')).host
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt', '/..%5csecret.txt', '/a/../../secret.txt', '/../other/x.css']) {
      const response = await server.serve(`dawsha-preview://${host}${path}`)
      expect(response.status, path).not.toBe(200)
      expect(text(response.body), path).not.toContain('top secret')
    }
  })
  it('does not serve files above the page folder even when they are inside the project', async () => {
    put('docs/page.html', 'x')
    put('root.css', 'root')
    const server = new PreviewServer(gate)
    const host = new URL(await open(server, 'docs/page.html')).host
    expect((await server.serve(`dawsha-preview://${host}/root.css`)).status).toBe(404)
  })
  it('refuses a link that points outside the project, as a folder or as a file', async () => {
    put('docs/page.html', 'x')
    writeFileSync(join(outside, 'secret.txt'), 'top secret')
    symlinkSync(outside, join(root, 'docs', 'escape'), 'junction')
    const server = new PreviewServer(gate)
    const host = new URL(await open(server, 'docs/page.html')).host
    const viaFolder = await server.serve(`dawsha-preview://${host}/escape/secret.txt`)
    expect(viaFolder.status).toBe(404)
    expect(text(viaFolder.body)).not.toContain('top secret')
    let fileLink = true
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'docs', 'leak.txt'), 'file')
    } catch {
      fileLink = false
    }
    if (fileLink) {
      const viaFile = await server.serve(`dawsha-preview://${host}/leak.txt`)
      expect(viaFile.status).toBe(404)
      expect(text(viaFile.body)).not.toContain('top secret')
    }
  })
  it('refuses a link to another folder of the same project', async () => {
    put('docs/page.html', 'x')
    put('private/notes.txt', 'private notes')
    symlinkSync(join(root, 'private'), join(root, 'docs', 'shortcut'), 'junction')
    const server = new PreviewServer(gate)
    const host = new URL(await open(server, 'docs/page.html')).host
    expect((await server.serve(`dawsha-preview://${host}/shortcut/notes.txt`)).status).toBe(404)
  })
  it('answers unknown tokens, missing files, folders and bad escapes without reading anything', async () => {
    put('docs/page.html', 'x')
    const server = new PreviewServer(gate)
    const host = new URL(await open(server, 'docs/page.html')).host
    expect((await server.serve('dawsha-preview://deadbeef/page.html')).status).toBe(404)
    expect((await server.serve(`dawsha-preview://${host}/nope.css`)).status).toBe(404)
    expect((await server.serve(`dawsha-preview://${host}/`)).status).toBe(404)
    expect((await server.serve(`dawsha-preview://${host}/%E0%A4%A`)).status).toBe(400)
    expect((await server.serve('not a url')).status).toBe(400)
  })
  it('stops serving when the project is no longer a known folder', async () => {
    put('docs/page.html', 'x')
    put('docs/style.css', 'x')
    let known = true
    const server = new PreviewServer(async (folder) => (known ? folder : null))
    const host = new URL(await open(server, 'docs/page.html')).host
    expect((await server.serve(`dawsha-preview://${host}/style.css`)).status).toBe(200)
    known = false
    expect((await server.serve(`dawsha-preview://${host}/style.css`)).status).toBe(403)
  })
})
