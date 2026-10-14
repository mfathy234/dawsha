import { describe, expect, it } from 'vitest'
import { deviceNameFromAgent, pairingCodeFromHash, pairingLink } from '../../src/shared/remotePairing'

describe('remote pairing links', () => {
  it('puts a valid code in the fragment and drops an existing one', () => {
    expect(pairingLink('https://a.trycloudflare.com/dawsha/', '123456')).toBe('https://a.trycloudflare.com/dawsha/#pair=123456')
    expect(pairingLink('https://a.trycloudflare.com/dawsha/#old', '654321')).toBe('https://a.trycloudflare.com/dawsha/#pair=654321')
  })

  it('links without a code when there is no valid one', () => {
    expect(pairingLink('https://a.trycloudflare.com/dawsha/', null)).toBe('https://a.trycloudflare.com/dawsha/')
    expect(pairingLink('https://a.trycloudflare.com/dawsha/', '12ab56')).toBe('https://a.trycloudflare.com/dawsha/')
  })

  it('reads only a six-digit code from the fragment', () => {
    expect(pairingCodeFromHash('#pair=123456')).toBe('123456')
    expect(pairingCodeFromHash('pair=123456')).toBe('123456')
    expect(pairingCodeFromHash('#pair=12345')).toBeNull()
    expect(pairingCodeFromHash('#pair=1234567')).toBeNull()
    expect(pairingCodeFromHash('#other=123456')).toBeNull()
    expect(pairingCodeFromHash('')).toBeNull()
  })

  it('names the browser from its user agent', () => {
    expect(deviceNameFromAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari')
    expect(deviceNameFromAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36')).toBe('Android · Chrome')
    expect(deviceNameFromAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Chrome')
    expect(deviceNameFromAgent('curl/8.0')).toBe('Browser')
  })
})
