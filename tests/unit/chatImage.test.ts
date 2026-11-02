import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkImageFile } from '../../src/main/chatLog/imageAccess'
import { ImageCollector, ImageTable } from '../../src/main/chatLog/imageTable'
import { fileUrlToPath, imageSize, mimeFromName, parseImageDataUrl, sniffImageMime, stripImageMarkers } from '../../src/shared/chatImage'
import { GIF_BASE64, JPEG_BASE64, PNG_BASE64, PNG_DATA_URL, SVG_TEXT, bytesOf } from '../support/tinyImages'

describe('sniffImageMime', () => {
  it('names real pictures by their first bytes', () => {
    expect(sniffImageMime(bytesOf(PNG_BASE64))).toBe('image/png')
    expect(sniffImageMime(bytesOf(GIF_BASE64))).toBe('image/gif')
    expect(sniffImageMime(bytesOf(JPEG_BASE64))).toBe('image/jpeg')
  })

  it('never accepts SVG, text or short input, whatever it is called', () => {
    expect(sniffImageMime(Buffer.from(SVG_TEXT))).toBeNull()
    expect(sniffImageMime(Buffer.from('hello world, not a picture'))).toBeNull()
    expect(sniffImageMime(Buffer.from([0x89, 0x50]))).toBeNull()
  })
})

describe('imageSize', () => {
  it('reads the size from the header', () => {
    expect(imageSize(bytesOf(PNG_BASE64))).toEqual({ width: 1, height: 1 })
    expect(imageSize(bytesOf(GIF_BASE64))).toEqual({ width: 1, height: 1 })
    expect(imageSize(bytesOf(JPEG_BASE64))).toEqual({ width: 1, height: 1 })
    expect(imageSize(Buffer.from(SVG_TEXT))).toBeNull()
  })
})

describe('data and file URLs', () => {
  it('splits an image data URL and refuses others', () => {
    expect(parseImageDataUrl(PNG_DATA_URL)).toEqual({ mime: 'image/png', base64: PNG_BASE64 })
    expect(parseImageDataUrl('data:text/html;base64,PGI+')).toBeNull()
    expect(parseImageDataUrl('https://x.test/a.png')).toBeNull()
  })

  it('turns file URLs into paths', () => {
    expect(fileUrlToPath('file:///C:/Users/me/My%20Pics/a.png')).toBe('C:\\Users\\me\\My Pics\\a.png')
    expect(fileUrlToPath('file:///home/me/a.png')).toBe('/home/me/a.png')
    expect(fileUrlToPath('file://server/share/a.png')).toBeNull()
    expect(fileUrlToPath('C:\\a\\b.png')).toBe('C:\\a\\b.png')
    expect(fileUrlToPath('relative/a.png')).toBeNull()
  })

  it('knows picture extensions', () => {
    expect(mimeFromName('x.PNG')).toBe('image/png')
    expect(mimeFromName('x.svg')).toBeNull()
  })
})

describe('stripImageMarkers', () => {
  it('hides the marker and keeps the path', () => {
    expect(stripImageMarkers('[Image: source: C:\\a\\b.png]')).toEqual({ text: '', paths: ['C:\\a\\b.png'] })
    expect(stripImageMarkers('look\n[Image: source: /tmp/x.png]\nplease')).toEqual({ text: 'look\n\nplease', paths: ['/tmp/x.png'] })
    expect(stripImageMarkers('plain')).toEqual({ text: 'plain', paths: [] })
  })
})

describe('ImageTable', () => {
  it('evicts the oldest pictures past its byte cap and keeps the newest', () => {
    const table = new ImageTable(100)
    const entry = (n: number) => ({ kind: 'bytes' as const, mime: 'image/png', data: Buffer.alloc(n) })
    table.add('a', entry(60))
    table.add('b', entry(60))
    expect(table.get('a')).toBeUndefined()
    expect(table.get('b')).toBeDefined()
    table.add('c', entry(500))
    expect(table.get('c')).toBeDefined()
    expect(table.size).toBe(1)
  })
})

describe('ImageCollector', () => {
  it('makes references for real pictures and ignores anything else', () => {
    const collector = new ImageCollector()
    const ref = collector.fromBase64(PNG_BASE64)
    expect(ref).toMatchObject({ source: 'log', mime: 'image/png', width: 1, height: 1 })
    expect(collector.get(ref?.id ?? '')?.kind).toBe('bytes')
    expect(collector.fromBase64(Buffer.from(SVG_TEXT).toString('base64'))).toBeNull()
    expect(collector.fromFile('C:\\x\\notes.txt')).toBeNull()
    expect(collector.fromFile('C:\\x\\shot.png')).toMatchObject({ source: 'file', label: 'shot.png' })
  })

  it('marks an oversize payload instead of holding it', () => {
    const collector = new ImageCollector()
    const ref = collector.fromBase64('A'.repeat(15 * 1024 * 1024))
    expect(collector.get(ref?.id ?? '')?.kind).toBe('oversize')
  })
})

describe('checkImageFile', () => {
  let root: string
  let outside: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dawsha-img-root-'))
    outside = mkdtempSync(join(tmpdir(), 'dawsha-img-out-'))
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', 'a.png'), bytesOf(PNG_BASE64))
    writeFileSync(join(outside, 'b.png'), bytesOf(PNG_BASE64))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  it('accepts a file inside the project', async () => {
    expect((await checkImageFile(join(root, 'sub', 'a.png'), [root])).ok).toBe(true)
  })

  it('blocks a file outside every allowed folder, a relative path and a dot-dot escape', async () => {
    expect(await checkImageFile(join(outside, 'b.png'), [root])).toEqual({ ok: false, status: 'blocked' })
    expect(await checkImageFile('sub/a.png', [root])).toEqual({ ok: false, status: 'blocked' })
    expect(await checkImageFile(join(root, 'sub', '..', '..', 'x', 'b.png'), [root])).toMatchObject({ ok: false })
  })

  it('reports a missing file and a directory', async () => {
    expect(await checkImageFile(join(root, 'nope.png'), [root])).toEqual({ ok: false, status: 'missing' })
    expect(await checkImageFile(join(root, 'sub'), [root])).toEqual({ ok: false, status: 'missing' })
  })

  it('refuses a link that leaves the project', async () => {
    try {
      symlinkSync(outside, join(root, 'link'), 'junction')
    } catch {
      return
    }
    expect(await checkImageFile(join(root, 'link', 'b.png'), [root])).toEqual({ ok: false, status: 'blocked' })
  })

  it('refuses a file over the size cap', async () => {
    writeFileSync(join(root, 'big.png'), Buffer.alloc(10 * 1024 * 1024 + 1))
    expect(await checkImageFile(join(root, 'big.png'), [root])).toEqual({ ok: false, status: 'too-large' })
  })
})
