import { describe, expect, it } from 'vitest'
import { errorsMessage, isWebUrl, parseBrowserAddress, validBounds } from '../../src/shared/browserPane'

describe('parseBrowserAddress', () => {
  it('opens local servers over http and everything else over https', () => {
    expect(parseBrowserAddress('localhost:5173')).toEqual({ ok: true, url: 'http://localhost:5173/' })
    expect(parseBrowserAddress('127.0.0.1:3000/app')).toEqual({ ok: true, url: 'http://127.0.0.1:3000/app' })
    expect(parseBrowserAddress('[::1]:8080')).toEqual({ ok: true, url: 'http://[::1]:8080/' })
    expect(parseBrowserAddress('example.com/docs')).toEqual({ ok: true, url: 'https://example.com/docs' })
    expect(parseBrowserAddress('  https://example.com  ')).toEqual({ ok: true, url: 'https://example.com/' })
    expect(parseBrowserAddress('http://localhost:3000/a?b=1#c')).toEqual({ ok: true, url: 'http://localhost:3000/a?b=1#c' })
  })

  it('refuses every other scheme', () => {
    for (const bad of ['file:///C:/secret.txt', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'about:blank', 'chrome://gpu', 'devtools://x', 'view-source:http://a.com', 'ftp://a.com', 'ws://a.com', 'blob:http://a/1', 'mailto:a@b.c', 'JAVASCRIPT:alert(1)'])
      expect(parseBrowserAddress(bad), bad).toMatchObject({ ok: false })
  })

  it('refuses credentials, spaces, control characters, empties and huge input', () => {
    expect(parseBrowserAddress('http://user:pw@host.com')).toMatchObject({ ok: false })
    expect(parseBrowserAddress('http://exa mple.com')).toMatchObject({ ok: false })
    expect(parseBrowserAddress('http://a.com/\u0000')).toMatchObject({ ok: false })
    expect(parseBrowserAddress('')).toMatchObject({ ok: false })
    expect(parseBrowserAddress('   ')).toMatchObject({ ok: false })
    expect(parseBrowserAddress(undefined)).toMatchObject({ ok: false })
    expect(parseBrowserAddress(`http://a.com/${'x'.repeat(3000)}`)).toMatchObject({ ok: false })
    expect(parseBrowserAddress('http://')).toMatchObject({ ok: false })
  })
})

describe('isWebUrl', () => {
  it('allows only plain http and https', () => {
    expect(isWebUrl('https://a.com/x')).toBe(true)
    expect(isWebUrl('http://localhost:1')).toBe(true)
    expect(isWebUrl('file:///x')).toBe(false)
    expect(isWebUrl('javascript:1')).toBe(false)
    expect(isWebUrl('http://u:p@a.com')).toBe(false)
    expect(isWebUrl('nonsense')).toBe(false)
  })
})

describe('validBounds', () => {
  it('needs four finite numbers', () => {
    expect(validBounds({ x: 0, y: 1, width: 300, height: 200 })).toBe(true)
    expect(validBounds({ x: 0, y: 1, width: NaN, height: 200 })).toBe(false)
    expect(validBounds({ x: 0, y: 1, width: 300 })).toBe(false)
    expect(validBounds(null)).toBe(false)
    expect(validBounds({ x: 0, y: 0, width: 1e9, height: 1 })).toBe(false)
  })
})

describe('errorsMessage', () => {
  it('lists the latest errors with the page', () => {
    const text = errorsMessage('http://localhost:3000/', ['TypeError: x is undefined (app.js:3)', 'Failed to load /a.png'])
    expect(text).toContain('http://localhost:3000/')
    expect(text).toContain('- Failed to load /a.png')
  })
})
